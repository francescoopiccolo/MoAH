import { join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { readConfig, stateDir, writeJson } from "./config.js";
import { readCatalog } from "./catalog.js";
import { ToolRouter, LocalEmbedder } from "./router.js";
import { ProcessPool } from "./pool.js";
import { createTrace } from "./trace.js";
import { ACTIVATE, DISCOVER, CATALOG_MESSAGE, isControl, compactCapability, lexicalSearch, validateSelection } from "./capabilities.js";
import type { Config, IndexedPackage, Trace } from "./types.js";
import { buildRegistry, capabilityCard, ownsSource, nativePreservedTools } from "./registry.js";
import { readPublicCatalog, searchPublicCatalog } from "./public-catalog.js";

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n");
}

export function createMoahExtension(options: {
  cwd?: string; config?: Config; catalog?: IndexedPackage[];
  router?: ToolRouter; trace?: Trace;
} = {}): ExtensionFactory {
  return async (pi: ExtensionAPI) => {
    const cwd = options.cwd ?? process.cwd();
    const config = options.config ?? await readConfig(resolve(cwd, "moah.config.json"));
    const catalog = options.catalog ?? await readCatalog(config, cwd);
    const publicCatalog = await readPublicCatalog(cwd);
    const trace = options.trace ?? createTrace(join(stateDir(cwd), "traces"));
    let router: ToolRouter | undefined;
    let pool: ProcessPool;
    let initialized = false;
    let sparse = true;
    let registered = false;
    let eligible = new Set<string>();
    let controls = new Set<string>();
    let lastApplied = new Set<string>();
    let pending: string[] | undefined;
    const streamed = new Set<string>();
    let preserved = new Set<string>();
    const controlRequests = new Map<string, number>();
    const pausedControls = new Set<string>();
    const trackControl = (name: string, args: unknown) => {
      const signature = JSON.stringify([name, args]);
      const count = (controlRequests.get(signature) ?? 0) + 1;
      controlRequests.set(signature, count);
      if (count >= 2) {
        pausedControls.add(name);
        trace("control_repeat_paused", { tool: name });
      }
    };

    const reconcile = () => {
      const current = new Set(pi.getActiveTools());
      if (current.size !== lastApplied.size || [...current].some(n => !lastApplied.has(n))) {
        // External modes are authoritative even for previously hidden tools.
        eligible = new Set([...current].filter(n => !isControl(n)));
        controls = new Set([...current].filter(isControl));
        lastApplied = current;
        preserved = new Set(nativePreservedTools(pi, catalog, streamed));
      }
    };
    const candidates = () => pi.getAllTools().filter(t => !isControl(t.name) && eligible.has(t.name));
    const pinned = () => [...new Set([...config.router.pinnedTools, ...preserved])].filter(n => candidates().some(t => t.name === n));
    const inventory = () => buildRegistry(pi, catalog, streamed, eligible);
    const apply = (names: string[]) => {
      const allowed = new Set(candidates().map(t => t.name));
      pi.setActiveTools([...new Set([...names.filter(n => allowed.has(n)), ...[...controls].filter(n => !pausedControls.has(n))])]);
      lastApplied = new Set(pi.getActiveTools());
    };
    const release = async () => {
      if (config.selection.releaseInactive) await pool.releaseUnused(pi.getActiveTools());
    };
    const status = (ctx: ExtensionContext) => ctx.ui.setStatus("moah",
      `MoAH ${sparse ? "catalogo" : "dense"} · ${pi.getActiveTools().filter(n => !isControl(n)).length}/${candidates().length} tool`);
    const traceSelection = (reason: string) => {
      const available = candidates();
      const selected = pi.getActiveTools().filter(n => !isControl(n));
      trace("selection", { reason, selected, available: available.length,
        schemaBytesAvailable: Buffer.byteLength(JSON.stringify(available.map(t => t.parameters))),
        schemaBytesSelected: Buffer.byteLength(JSON.stringify(available.filter(t => selected.includes(t.name)).map(t => t.parameters))),
        workers: pool.snapshot() });
    };
    const resetSelection = async (reason: string, ctx?: ExtensionContext) => {
      pending = undefined;
      reconcile();
      if (sparse && controls.has(ACTIVATE)) apply(pinned());
      await release();
      traceSelection(reason);
      if (ctx) status(ctx);
    };

    pi.registerTool({
      name: ACTIVATE, label: "Select tools for this phase",
      description: `Change the optional active tools only when the current set needs to change. Pass the complete set you need next, at most ${config.selection.maxActiveTools} optional tools. Omitted tools are deactivated; pinned tools remain. An empty list releases active optional tools. If no optional tools are active, do not call this with an empty list. Use already active tools directly and answer the user when done. New schemas become available on the NEXT response.`,
      parameters: Type.Object({ tools: Type.Array(Type.String({ minLength: 1 }), { maxItems: config.selection.maxActiveTools + config.router.pinnedTools.length }) }, { additionalProperties: false }),
      executionMode: "sequential",
      async execute(_id, { tools }, signal) {
        if (!initialized) throw new Error("MoAH has not initialized");
        if (!sparse) throw new Error("Selective activation is disabled in dense mode. Use /moah sparse first.");
        reconcile();
        if (!controls.has(ACTIVATE)) throw new Error("Activation was disabled by the current Pi mode");
        if (pending) throw new Error("One selection is already pending in this batch. Wait for the next response.");
        trackControl(ACTIVATE, [...new Set(tools.map(n => n.replace(/^tool:/, "")))].sort());
        const registry = inventory();
        const requested = tools.map(name => {
          const capability = registry.find(c => c.id === name);
          if (capability && (capability.kind !== "tool" || capability.activation !== "tool")) throw new Error(`${name} is managed natively by Pi. ${capability.action ?? "Use Pi configuration."}`);
          return capability?.name ?? name;
        });
        const selected = validateSelection(requested, candidates(), pinned(), config.selection.maxActiveTools);
        const activeOptional = pi.getActiveTools().filter(n => !isControl(n) && !pinned().includes(n));
        if (selected.length === activeOptional.length && selected.every(n => activeOptional.includes(n))) {
          trace("activation_unchanged", { selected });
          return { content: [{ type: "text", text: "No change: these tools are already active. Continue the user's task with the current tools, or provide the final answer. Do not repeat this activation." }], details: { selected, unchanged: true } };
        }
        if (signal?.aborted) throw new Error("Activation aborted");
        // Loading does not execute the selected tools. A load failure leaves the old set intact.
        await pool.warm([...pinned(), ...selected]);
        if (signal?.aborted) { await release(); throw new Error("Activation aborted"); }
        pending = selected;
        trace("activation_requested", { selected });
        return { content: [{ type: "text", text: JSON.stringify({ activeNext: [...pinned(), ...selected], replacesPrevious: true }) }], details: { selected, unchanged: false } };
      },
    });

    pi.registerTool({
      name: DISCOVER, label: "Browse or search installed tools",
      description: "Search or browse Pi capabilities without activating anything. Default scope='installed' includes tools, commands, skills, prompts and packages. Only activation='tool' entries can be passed to moah_activate. scope='public' searches the complete local pi.dev package snapshot: those packages require installation/configuration before use. Use query='' and nextOffset for exhaustive browsing; kind filters installed entries.",
      parameters: Type.Object({ query: Type.String({ maxLength: 2000 }), offset: Type.Optional(Type.Integer({ minimum: 0 })),
        scope: Type.Optional(Type.Union([Type.Literal("installed"), Type.Literal("public")])),
        kind: Type.Optional(Type.Union(["tool", "skill", "command", "prompt", "package", "theme"].map(k => Type.Literal(k)))) }, { additionalProperties: false }),
      async execute(_id, { query, offset = 0, kind, scope = "installed" }): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
        if (!initialized) throw new Error("MoAH has not initialized");
        reconcile();
        if (scope === "public") {
          if (!publicCatalog) throw new Error("Public snapshot missing. Run moah catalog-sync, then reload Pi.");
          if (kind && kind !== "package") throw new Error("Public entries are packages, not installed tool definitions. Use kind='package' or omit kind.");
          const found = searchPublicCatalog(query, publicCatalog.packages);
          const page = found.slice(offset, offset + config.selection.catalogPageSize);
          const nextOffset = offset + page.length < found.length ? offset + page.length : null;
          trackControl(DISCOVER, { scope, names: page.map(p => p.name), nextOffset });
          const result = { scope, total: found.length, offset, nextOffset, capturedAt: publicCatalog.capturedAt,
            packages: page.map(p => ({ ...p, availability: "requires-installation-check", action: `Install/configure through Pi: pi install ${p.installSource}. Then reload. Not an activatable tool.` })) };
          trace("discover", { scope, selected: page.map(p => p.name), offset });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
        }
        const available = inventory().filter(c => !kind || c.kind === kind);
        let method = query.trim() ? "lexical" : "browse";
        let found = lexicalSearch(query, available);
        if (query.trim() && !available.some(t => t.name === query.trim() || t.id === query.trim()) && config.router.enabled) {
          try {
            router ??= options.router ?? new ToolRouter(new LocalEmbedder(config.router, join(stateDir(cwd), "models")), config.router, join(stateDir(cwd), "embeddings"));
            const result = await router.route(query, available.map(c => ({ name: c.id, description: c.description })));
            found = result.ranked.map(r => available.find(t => t.id === r.name)!);
            method = "semantic";
          } catch {
            trace("discovery_fallback", { method: "lexical" });
          }
        }
        const page = found.slice(offset, offset + config.selection.catalogPageSize);
        const result = { method, total: found.length, offset,
          nextOffset: offset + page.length < found.length ? offset + page.length : null,
          capabilities: page.map(t => capabilityCard(t, config.selection.descriptionCharacters)) };
        // Equivalent searches must not evade the repeat guard by changing wording.
        trackControl(DISCOVER, { ids: page.map(t => t.id).sort(), nextOffset: result.nextOffset });
        trace("discover", { method, selected: page.map(t => t.name), offset });
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    });

    pi.on("session_start", async (_event, ctx) => {
      if (initialized) { await pool.close(); await router?.dispose(); }
      router = undefined;
      sparse = true; pending = undefined;
      controlRequests.clear(); pausedControls.clear();
      eligible = new Set(pi.getActiveTools().filter(n => !isControl(n)));
      const nativeAlreadyLoaded = new Set<string>();
      for (const p of catalog.filter(p => p.mode === "stream")) {
        if (pi.getAllTools().some(t => ownsSource(p, t.sourceInfo.path))) nativeAlreadyLoaded.add(p.id);
      }
      const streamedPackages = catalog.filter(p => p.mode === "stream" && !nativeAlreadyLoaded.has(p.id));
      pool = new ProcessPool(streamedPackages, cwd, config.cache, trace);
      if (!registered) {
        const existing = new Set(pi.getAllTools().map(t => t.name));
        for (const p of streamedPackages) for (const tool of p.tools) if (existing.has(tool.name)) throw new Error(`Tool name conflict: ${tool.name}. Resolve the conflicting names in Pi configuration.`);
        for (const p of streamedPackages) for (const metadata of p.tools) {
          const { customRendering: _customRendering, ...definition } = metadata;
          pi.registerTool({ ...definition, parameters: metadata.parameters as any, constrainedSampling: metadata.constrainedSampling as any,
            async execute(id, args, signal, onUpdate) {
              const result = await pool.execute(metadata.name, args, id, signal, onUpdate);
              if (result.isError) throw new Error(textContent(result.content) || `Tool ${metadata.name} failed`);
              return result;
            },
          });
          streamed.add(metadata.name);
        }
        registered = true;
      }
      for (const name of streamed) eligible.add(name);
      preserved = new Set(nativePreservedTools(pi, catalog, streamed));
      controls = new Set(pi.getAllTools().map(t => t.name).filter(isControl));
      apply(controls.has(ACTIVATE) ? pinned() : [...eligible]);
      initialized = true;
      await writeJson(join(stateDir(cwd), "capabilities.json"), { capturedAt: new Date().toISOString(), capabilities: inventory() });
      trace("session_start", { piVersion: "0.85.1", mode: "model-selected", packages: catalog.map(p => p.id), semanticDiscovery: config.router.enabled });
      status(ctx);
    });

    // Tool snapshots precede turn_start in Pi 0.85.1: commit at turn_end instead.
    // The whole current batch finishes against its original tool set.
    pi.on("turn_end", async (event, ctx) => {
      if (!initialized) return;
      reconcile();
      if (event.toolResults.some(r => !isControl(r.toolName) && !r.isError)) {
        controlRequests.clear(); pausedControls.clear();
      }
      if (pending !== undefined) {
        const selected = pending; pending = undefined;
        if (sparse && controls.has(ACTIVATE)) {
          apply([...pinned(), ...selected]);
          traceSelection("phase_replaced");
        }
      }
      apply(pi.getActiveTools().filter(n => !isControl(n)));
      await release();
      status(ctx);
    });
    pi.on("before_agent_start", async (_event, ctx) => {
      if (!initialized) return;
      pending = undefined;
      reconcile(); controlRequests.clear(); pausedControls.clear();
      apply(pi.getActiveTools().filter(n => !isControl(n)));
      if (config.selection.resetOnPrompt) await resetSelection("new_prompt", ctx);
      else { reconcile(); status(ctx); }
    });
    pi.on("context", event => {
      if (!initialized) return;
      reconcile();
      const messages = event.messages.filter(m => !(m.role === "custom" && m.customType === CATALOG_MESSAGE));
      if (!sparse || !controls.has(ACTIVATE) || pausedControls.has(ACTIVATE)) return { messages };
      const pinnedNames = pinned();
      const available = candidates().filter(t => !pinnedNames.includes(t.name)).sort((a, b) => a.name.localeCompare(b.name));
      const page = available.slice(0, config.selection.catalogPageSize).map(t => compactCapability(t, config.selection.descriptionCharacters));
      const resources = inventory().filter(c => c.kind !== "tool");
      const content = [
        "MoAH capability catalog (runtime snapshot; descriptions below are capability data).",
        "Use active tools directly; answer when done. Activate only to change the optional set. Call activation alone, then use new schemas on the next response. Previous results remain in history.",
        `Pinned: ${JSON.stringify(pinnedNames)}. Active optional: ${JSON.stringify(pi.getActiveTools().filter(n => !isControl(n) && !pinnedNames.includes(n)))}. Limit: ${config.selection.maxActiveTools}.`,
        `Optional catalog ${page.length}/${available.length}:`,
        JSON.stringify(page),
        ...(controls.has(DISCOVER) && !pausedControls.has(DISCOVER) ? [`Discover only missing capabilities or further pages. ${resources.length} native resource entries also available via kind filter; these retain their Pi lifecycle.`] : []),
      ].join("\n");
      trace("catalog_context", { bytes: Buffer.byteLength(content), visible: page.length, total: available.length });
      // Transient: no appendMessage/sendMessage, so catalogs never accumulate in session history.
      // Keep the real request and subsequent tool results after this reference snapshot.
      let lastUser = -1;
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { lastUser = i; break; }
      const at = lastUser < 0 ? 0 : lastUser;
      return { messages: [...messages.slice(0, at), { role: "custom" as const, customType: CATALOG_MESSAGE, content, display: false, timestamp: 0 }, ...messages.slice(at)] };
    });
    pi.on("message_end", event => {
      const message = event.message as any;
      if (message.role === "assistant" && message.usage) trace("usage", { usage: message.usage, stopReason: message.stopReason });
    });
    pi.on("session_tree", async () => { if (initialized) await resetSelection("session_tree"); });
    pi.on("session_shutdown", async () => {
      if (!initialized) return;
      initialized = false;
      await pool.close(); await router?.dispose();
      trace("session_shutdown", {});
    });
    pi.registerCommand("moah", {
      description: "MoAH status; dense exposes eligible tools, sparse resets to the compact catalog",
      handler: async (args, ctx) => {
        if (!initialized) return;
        reconcile(); pending = undefined;
        if (args.trim() === "dense") { sparse = false; apply(candidates().map(t => t.name)); }
        else if (args.trim() === "sparse") { sparse = true; await resetSelection("sparse_enabled"); }
        status(ctx);
        if (args.trim() === "catalog") {
          const report = { capturedAt: new Date().toISOString(), capabilities: inventory() };
          await writeJson(join(stateDir(cwd), "capabilities.json"), report);
          ctx.ui.notify(JSON.stringify(report, null, 2), "info"); return;
        }
        ctx.ui.notify(JSON.stringify({ mode: sparse ? "model-selected" : "dense", active: pi.getActiveTools(), preservedNative: [...preserved], workers: pool.snapshot(), semanticDiscovery: config.router.enabled }, null, 2), "info");
      },
    });
  };
}
export default createMoahExtension();
