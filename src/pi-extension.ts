import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { readConfig, stateDir } from "./config.js";
import { ApiToolRouter } from "./router.js";
import { createTrace } from "./trace.js";
import { SELECT, isControl, toCandidate, validateSelection } from "./capabilities.js";
import { catalogForRouter, readOfficialCatalog } from "./official-catalog.js";
import { MoahTracer, usageToMetadata } from "./observability.js";
import type { Config, RouteResult, Trace } from "./types.js";

export function createMoahExtension(options: {
  cwd?: string;
  config?: Config;
  router?: ApiToolRouter;
  trace?: Trace;
} = {}): ExtensionFactory {
  return async (pi: ExtensionAPI) => {
    const cwd = options.cwd ?? process.cwd();
    const config = options.config ?? await readConfig(join(cwd, "moah.config.json"));
    const officialCatalog = await readOfficialCatalog();
    const officialCandidates = catalogForRouter(officialCatalog, config.router.baseTools);
    const officialDescriptions = new Map(officialCandidates.map(candidate => [candidate.name, candidate.description]));
    const trace = options.trace ?? createTrace(join(stateDir(cwd), "traces"));
    let router: ApiToolRouter | undefined;
    let initialized = false;
    let lastRoute: RouteResult | undefined;
    let tracer: MoahTracer | undefined;
    let activeTurnSpan: ReturnType<MoahTracer["child"]>;

    const allTools = () => pi.getAllTools().filter(tool => !isControl(tool.name));
    const baseNames = () => config.router.baseTools.filter(name => allTools().some(tool => tool.name === name));
    const candidateTools = () => {
      const available = new Set(allTools().map(tool => tool.name));
      const base = new Set(baseNames());
      const catalogCandidates = officialCandidates
        .filter(candidate => available.has(candidate.name))
        .map(candidate => ({ name: candidate.name, description: candidate.description }));
      const catalogNames = new Set(catalogCandidates.map(candidate => candidate.name));
      const extras = allTools()
        .filter(tool => !base.has(tool.name) && !catalogNames.has(tool.name))
        .map(tool => toCandidate({
          name: tool.name,
          description: officialDescriptions.get(tool.name) ?? tool.description,
        }, 180));
      return [...catalogCandidates, ...extras];
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
      ctx.ui.setStatus(
        "moah",
        `router=${config.router.enabled ? config.router.mode : "off"} · ${pi.getActiveTools().filter(name => !isControl(name)).length} tools`,
      );
    };

    pi.registerTool({
      name: SELECT,
      label: "Select optional tools",
      description: `Replace the current optional tools with the exact names you need. Empty list releases optional tools. Base tools remain active.`,
      parameters: Type.Object({
        tools: Type.Array(Type.String({ minLength: 1 }), { maxItems: config.router.maxTools }),
      }, { additionalProperties: false }),
      async execute(_id, { tools }: { tools: string[] }) {
        if (!initialized) throw new Error("MoAH has not initialized");
        const selected = validateSelection(tools, candidateTools(), config.router.maxTools);
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

      if (config.router.enabled) {
        applyOptional([]);
      } else {
        pi.setActiveTools([
          ...pi.getActiveTools().filter(name => !isControl(name)),
          ...(hasControl() ? [SELECT] : []),
        ]);
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
      trace("session_shutdown", {});
      await tracer?.end({});
      await tracer?.flush();
    });

    pi.registerCommand("moah", {
      description: "MoAH status; dense exposes all optional tools, sparse releases them",
      handler: async (args, ctx) => {
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
        }, null, 2), "info");
      },
    });
  };
}

export default createMoahExtension();
