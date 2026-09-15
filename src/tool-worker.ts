import { createRequire } from "node:module";
import { createJiti } from "jiti";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ToolMetadata } from "./types.js";

const require = createRequire(import.meta.url);
const alias: Record<string, string> = {};
for (const name of ["pi-coding-agent", "pi-tui", "pi-agent-core", "pi-ai"]) {
  try { alias[`@mariozechner/${name}`] = require.resolve(`@earendil-works/${name}`); } catch { /* unused alias */ }
}
alias["@sinclair/typebox"] = require.resolve("typebox");
const tools = new Map<string, any>();
const unsupported = new Set<string>();
const controllers = new Map<string, AbortController>();
let loaded = false;
const send = (message: unknown) => { if (process.connected) process.send?.(message); };
const failAccess = (name: string): never => {
  unsupported.add(name);
  throw new Error(`Unsupported in streamed tool process: ${name}. Load this extension natively in Pi instead.`);
};
const api = new Proxy({
  registerTool(tool: any) {
    if (!tool || typeof tool.name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(tool.name) ||
        typeof tool.description !== "string" || typeof tool.execute !== "function" ||
        !tool.parameters || tools.has(tool.name)) throw new Error("Invalid or duplicate tool definition");
    if (tool.prepareArguments) failAccess("prepareArguments");
    tools.set(tool.name, tool);
  },
}, {
  get(target, key) {
    if (key in target) return target[key as keyof typeof target];
    return failAccess(`pi.${String(key)}`);
  },
});

function metadata(): ToolMetadata[] {
  return [...tools.values()].map(t => ({
    name: t.name, label: t.label ?? t.name, description: t.description, parameters: t.parameters,
    promptSnippet: t.promptSnippet, promptGuidelines: t.promptGuidelines,
    executionMode: t.executionMode, constrainedSampling: t.constrainedSampling,
    customRendering: !!(t.renderCall || t.renderResult),
  }));
}

process.on("message", async (message: any) => {
  if (message.op === "cancel") { controllers.get(message.callId)?.abort(); return; }
  const { id, op } = message;
  try {
    if (op === "load") {
      if (loaded) throw new Error("A worker hosts exactly one package");
      const workerAliases = { ...alias };
      if (message.lazySdk) {
        const adapter = [new URL("../scripts/lazy-pi-sdk.cjs", import.meta.url), new URL("../../scripts/lazy-pi-sdk.cjs", import.meta.url)].find(p => existsSync(p));
        if (!adapter) throw new Error("Lazy SDK adapter missing");
        workerAliases["@earendil-works/pi-coding-agent"] = fileURLToPath(adapter);
        workerAliases["@mariozechner/pi-coding-agent"] = fileURLToPath(adapter);
      }
      const jiti = createJiti(import.meta.url, { alias: workerAliases, moduleCache: false, fsCache: false });
      const factory = await jiti.import(message.entry, { default: true }) as any;
      if (typeof factory !== "function") throw new Error("Pi extension must export a default factory");
      await factory(api);
      if (unsupported.size) throw new Error(`Unsupported extension APIs: ${[...unsupported].join(", ")}`);
      if (!tools.size) throw new Error("Extension registered no tools");
      loaded = true;
      send({ id, result: { tools: metadata(), rss: process.memoryUsage().rss, pid: process.pid } });
    } else if (op === "call") {
      const tool = tools.get(message.name);
      if (!loaded || !tool) throw new Error(`Tool not loaded: ${message.name}`);
      const controller = new AbortController();
      controllers.set(id, controller);
      const ctx = new Proxy({ cwd: message.cwd, hasUI: false, signal: controller.signal }, {
        get(target, key) {
          if (key in target) return target[key as keyof typeof target];
          return failAccess(`ctx.${String(key)}`);
        },
      });
      try {
        const result = await tool.execute(message.callId, message.args, controller.signal,
          (update: unknown) => send({ id, update }), ctx);
        if (!result || !Array.isArray(result.content)) throw new Error("Invalid Pi tool result");
        send({ id, result, rss: process.memoryUsage().rss });
      } finally { controllers.delete(id); }
    } else if (op === "memory") {
      send({ id, result: { rss: process.memoryUsage().rss } });
    } else { throw new Error(`Unknown worker operation: ${op}`); }
  } catch (error) {
    send({ id, error: error instanceof Error ? error.message : String(error), rss: process.memoryUsage().rss });
  }
});
process.on("disconnect", () => process.exit(0));
