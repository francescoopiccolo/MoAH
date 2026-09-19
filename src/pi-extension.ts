import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "./extensions/types.js";
import { readConfig, stateDir } from "./config.js";
import { buildCatalog, readCatalog } from "./catalog.js";
import { ApiToolRouter } from "./router.js";
import { createTrace } from "./trace.js";
import { SELECT, isControl, toCandidate, validateSelection } from "./capabilities.js";
import { catalogForRouter, readOfficialCatalog } from "./official-catalog.js";
import { MoahTracer, usageToMetadata } from "./observability.js";
import { PackageCache } from "./streaming/package-cache.js";
import type { Config, IndexedPackage, RouteResult, Trace, ToolMetadata } from "./types.js";

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text)
    .join("\n");
}

export function createMoahExtension(options: {
  cwd?: string;
  config?: Config;
  catalog?: IndexedPackage[];
  router?: ApiToolRouter;
  trace?: Trace;
} = {}): ExtensionFactory {
  return async (pi: ExtensionAPI) => {
    const cwd = options.cwd ?? process.cwd();
    const config = options.config ?? await readConfig(join(cwd, "moah.config.json"));
    const catalog = options.catalog ?? await (async () => {
      try {
        return await readCatalog(config, cwd);
      } catch (error) {
        if (error instanceof Error && error.message.includes("Catalog missing")) {
          return await buildCatalog(config, cwd);
        }
        throw error;
      }
    })();
    const officialCatalog = await readOfficialCatalog();
    const officialCandidates = catalogForRouter(officialCatalog, config.router.baseTools);
    const officialDescriptions = new Map(officialCandidates.map(candidate => [candidate.name, candidate.description]));
    const streamPackages = catalog.filter(pkg => pkg.mode === "stream");
    const streamTools = new Map<string, { tool: ToolMetadata; packageId: string }>();
    for (const pkg of streamPackages) {
      for (const tool of pkg.tools) streamTools.set(tool.name, { tool, packageId: pkg.id });
    }
    const trace = options.trace ?? createTrace(join(stateDir(cwd), "traces"));
    let router: ApiToolRouter | undefined;
    let packageCache: PackageCache | undefined;
    let initialized = false;
    let lastRoute: RouteResult | undefined;
    let tracer: MoahTracer | undefined;
    let activeTurnSpan: ReturnType<MoahTracer["child"]>;
    const registeredStreamToolNames = new Set<string>();

    const allTools = () => pi.getAllTools().filter(tool => !isControl(tool.name));
    const baseNames = () => config.router.baseTools.filter(name => allTools().some(tool => tool.name === name));
    const candidateTools = () => {
      const base = new Set(baseNames());
      const known = new Map<string, string>();
      for (const tool of allTools()) {
        known.set(tool.name, officialDescriptions.get(tool.name) ?? tool.description);
      }
      for (const pkg of streamPackages) {
        for (const tool of pkg.tools) {
          if (!known.has(tool.name)) known.set(tool.name, tool.description);
        }
      }
      const catalogCandidates = officialCandidates
        .filter(candidate => known.has(candidate.name))
        .map(candidate => ({ name: candidate.name, description: candidate.description }));
      const catalogNames = new Set(catalogCandidates.map(candidate => candidate.name));
      const extras = [...known]
        .filter(([name]) => !base.has(name) && !catalogNames.has(name))
        .map(([name, description]) => toCandidate({ name, description }, 180));
      return [...catalogCandidates, ...extras];
    };
    const packageIdsForTools = (toolNames: string[]) => {
      const ids = new Set<string>();
      for (const name of toolNames) {
        const match = streamTools.get(name);
        if (match) ids.add(match.packageId);
      }
      return [...ids];
    };
    const registerStreamProxies = () => {
      const existing = new Set(pi.getAllTools().map(tool => tool.name));
      for (const pkg of streamPackages) {
        for (const metadata of pkg.tools) {
          if (registeredStreamToolNames.has(metadata.name)) continue;
          if (existing.has(metadata.name)) {
            throw new Error(`Tool name conflict: ${metadata.name}. Resolve the conflicting names in Pi configuration.`);
          }
          pi.registerTool({
            name: metadata.name,
            label: metadata.label,
            description: metadata.description,
            parameters: metadata.parameters as any,
            ...(metadata.promptSnippet !== undefined ? { promptSnippet: metadata.promptSnippet } : {}),
            ...(metadata.promptGuidelines !== undefined ? { promptGuidelines: metadata.promptGuidelines } : {}),
            ...(metadata.executionMode !== undefined ? { executionMode: metadata.executionMode } : {}),
            ...(metadata.constrainedSampling !== undefined ? { constrainedSampling: metadata.constrainedSampling as any } : {}),
            async execute(id: string, args: any, signal: AbortSignal | undefined, onUpdate: any) {
              if (!packageCache) throw new Error("MoAH streaming has not initialized");
              const result: any = await packageCache.execute(metadata.name, pkg.id, args, id, signal, onUpdate);
              if ((result as any)?.isError) {
                throw new Error(textContent((result as any).content) || `Tool ${metadata.name} failed`);
              }
              return result;
            },
          });
          existing.add(metadata.name);
          registeredStreamToolNames.add(metadata.name);
        }
      }
    };
    const hasControl = () => pi.getAllTools().some(tool => isControl(tool.name));

    const applyOptional = (selected: string[]) => {
      const valid = selected.filter(name => allTools().some(tool => tool.name === name));
      pi.setActiveTools([
        ...baseNames(),
        ...valid,
        ...(hasControl() ? [SELECT] : []),
      ]);
      trace("selection", { selected: valid, active: pi.getActiveTools() });
    };

    const status = (ctx: ExtensionContext) => {
      const snapshot = packageCache?.snapshot();
      const resident = snapshot?.entries.length ?? 0;
      const loading = snapshot?.loading.length ?? 0;
      ctx.ui.setStatus(
        "moah",
        `router=${config.router.enabled ? config.router.mode : "off"} · ${pi.getActiveTools().filter(name => !isControl(name)).length} tools · ${resident} resident/${loading} loading`,
      );
    };

    pi.registerTool({
      name: SELECT,
      label: "Select optional tools",
      description: `Replace the current optional tools with the exact names you need. Empty list releases optional tools. Base tools remain active.`,
      parameters: Type.Object({
        tools: Type.Array(Type.String({ minLength: 1 }), { maxItems: config.router.maxTools }),
      }, { additionalProperties: false }),
      async execute(_id: string, { tools }: { tools: string[] }) {
        if (!initialized) throw new Error("MoAH has not initialized");
        const selected = validateSelection(tools, candidateTools(), config.router.maxTools);
        packageCache?.beginTurn(packageIdsForTools(selected));
        void packageCache?.prefetch(packageIdsForTools(selected), "manual-select");
        applyOptional(selected);
        return {
          content: [{ type: "text", text: JSON.stringify({
            activeNext: [...baseNames(), ...selected],
            replacesPrevious: true,
          }) }],
          details: { selected, unchanged: JSON.stringify(selected) === JSON.stringify(pi.getActiveTools().filter(name => !isControl(name) && !baseNames().includes(name))) },
        };
      },
    });

    pi.on("input", async (event, ctx) => {
      if (event.source === "extension" || event.text.startsWith("/") || !config.router.enabled) {
        return { action: "continue" as const };
      }

      activeTurnSpan = tracer?.child("turn", "chain", {
        input: event.text,
        mode: config.router.mode,
      });

      if (config.router.mode === "oracle") {
        const oracleTools = (process.env.MOAH_ORACLE_TOOLS ?? "")
          .split(",")
          .map(name => name.trim())
          .filter(Boolean);
        applyOptional(oracleTools);
        packageCache?.beginTurn(packageIdsForTools(oracleTools));
        void packageCache?.prefetch(packageIdsForTools(oracleTools), "oracle");
        lastRoute = { selected: oracleTools, ranked: [], elapsedMs: 0 };
        trace("oracle", { selected: oracleTools });
        await tracer?.endChild(activeTurnSpan, {
          selection: oracleTools,
          source: "oracle",
        });
        activeTurnSpan = undefined;
        status(ctx);
        return { action: "continue" as const };
      }

      try {
        router ??= options.router ?? new ApiToolRouter(config.router);
        const routerSpan = activeTurnSpan?.createChild({
          name: "router",
          run_type: "llm",
          inputs: {
            request: event.text,
            candidates: candidateTools().map(tool => ({ name: tool.name, description: tool.description })),
          },
          metadata: {
            model: config.router.model,
          },
        });
        const route = await router.route(event.text, candidateTools());
        lastRoute = route;
        trace("router", {
          selected: route.selected,
          ranked: route.ranked,
          elapsedMs: route.elapsedMs,
          usage: route.usage,
          model: route.model,
          mode: config.router.mode,
        });
        await tracer?.endChild(routerSpan, {
          selected: route.selected,
          ranked: route.ranked,
          elapsed_ms: route.elapsedMs,
          usage: usageToMetadata(route.usage),
          model: route.model,
        });

        if (config.router.mode === "auto") {
          applyOptional(route.selected);
          const selectedPackages = packageIdsForTools(route.selected);
          packageCache?.beginTurn(selectedPackages);
          void packageCache?.prefetch(selectedPackages, "router-auto");
          status(ctx);
          return { action: "continue" as const };
        }

        if (route.selected.length > 0) {
          const suggestion = `[MoAH suggestion: ${route.selected.join(", ")}. Use ${SELECT} to activate them, or ignore this note.]`;
          return {
            action: "transform" as const,
            text: `${suggestion}\n\n${event.text}`,
            images: event.images,
          };
        }
        return { action: "continue" as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trace("router_failed", { error: message });
        await tracer?.endChild(activeTurnSpan, undefined, message);
        activeTurnSpan = undefined;
        ctx.ui.notify(`MoAH: router non eseguito (${message}). Continuo con i tool attuali.`, "warning");
        return { action: "continue" as const };
      }
    });

    pi.on("session_start", async (_event, ctx) => {
      router = options.router ?? new ApiToolRouter(config.router);
      lastRoute = undefined;
      activeTurnSpan = undefined;
      initialized = true;

      const sessionId = randomUUID();
      const configHash = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);
      const mainModel = ((ctx as any).getModel?.() as any);
      tracer = new MoahTracer({
        condition: `moah-${config.router.mode}`,
        configHash,
        mainModel: mainModel ? `${mainModel.provider ?? ""}/${mainModel.id ?? ""}` : undefined,
        routerModel: config.router.model,
        sessionId,
      });

      if (packageCache) await packageCache.close();
      packageCache = new PackageCache(streamPackages, cwd, config.streaming, trace);
      registerStreamProxies();

      if (config.router.enabled) {
        applyOptional([]);
      } else {
        pi.setActiveTools([
          ...pi.getActiveTools().filter(name => !isControl(name)),
          ...(hasControl() ? [SELECT] : []),
        ]);
      }
      if (!config.streaming.cold && config.streaming.hotPreload > 0) {
        void packageCache.preloadHot(config.streaming.hotPreload);
      }

      trace("session_start", {
        piVersion: "0.85.1",
        sessionId,
        configHash,
        mainModel: mainModel ? `${mainModel.provider ?? ""}/${mainModel.id ?? ""}` : undefined,
        router: {
          enabled: config.router.enabled,
          mode: config.router.mode,
          model: config.router.model,
        },
        baseTools: baseNames(),
        candidates: candidateTools().map(tool => tool.name),
        streamPackages: streamPackages.map(pkg => pkg.id),
        streaming: config.streaming,
      });
      status(ctx);
    });

    pi.on("message_end", async event => {
      const message = event.message as any;
      if (message?.role === "assistant" && message.usage) {
        trace("usage", { usage: message.usage, stopReason: message.stopReason });
      }
      if (activeTurnSpan) {
        await tracer?.endChild(activeTurnSpan, {
          stopReason: message?.stopReason,
          usage: message?.usage,
        });
        activeTurnSpan = undefined;
      }
    });

    pi.on("session_shutdown", async () => {
      if (!initialized) return;
      initialized = false;
      await packageCache?.close();
      packageCache = undefined;
      trace("session_shutdown", {});
      await tracer?.end({});
      await tracer?.flush();
    });

    pi.registerCommand("moah", {
      description: "MoAH status; dense exposes all optional tools, sparse releases them",
      handler: async (args: string, ctx: ExtensionContext) => {
        if (!initialized) return;
        if (args.trim() === "dense") applyOptional(candidateTools().map(tool => tool.name));
        else if (args.trim() === "sparse") applyOptional([]);
        status(ctx);
        ctx.ui.notify(JSON.stringify({
          router: {
            enabled: config.router.enabled,
            mode: config.router.mode,
            model: config.router.model,
          },
          active: pi.getActiveTools().filter(name => !isControl(name)),
          candidates: candidateTools().map(tool => tool.name),
          lastRoute,
          streaming: packageCache?.snapshot(),
        }, null, 2), "info");
      },
    });
  };
}

export default createMoahExtension();
