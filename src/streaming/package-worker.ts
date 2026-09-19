import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { ToolMetadata } from "../types.js";

const require = createRequire(import.meta.url);

const alias: Record<string, string> = {};
const workerSdkCompiled = existsSync(new URL("../worker-sdk/pi-coding-agent.js", import.meta.url));
const workerSdkExt = workerSdkCompiled ? ".js" : ".ts";
const workerSdk = (name: string) => fileURLToPath(new URL(`../worker-sdk/${name}${workerSdkExt}`, import.meta.url));

alias["@earendil-works/pi-coding-agent"] = workerSdk("pi-coding-agent");
alias["@mariozechner/pi-coding-agent"] = workerSdk("pi-coding-agent");
alias["@earendil-works/pi-ai"] = workerSdk("pi-ai");
alias["@mariozechner/pi-ai"] = workerSdk("pi-ai");
alias["@earendil-works/pi-tui"] = workerSdk("pi-tui");
alias["@mariozechner/pi-tui"] = workerSdk("pi-tui");
alias["@sinclair/typebox"] = require.resolve("typebox");
alias["typebox"] = require.resolve("typebox");

const tools = new Map<string, any>();
const unsupported = new Set<string>();
const controllers = new Map<string, AbortController>();
let loaded = false;

const send = (message: unknown) => {
  if (process.connected) process.send?.(message);
};

const failAccess = (name: string): never => {
  unsupported.add(name);
  throw new Error(`Unsupported in streamed tool process: ${name}. Load this extension natively in Pi instead.`);
};

const api = new Proxy(
  {
    registerTool(tool: any) {
      if (
        !tool ||
        typeof tool.name !== "string" ||
        !/^[a-zA-Z0-9_-]+$/.test(tool.name) ||
        typeof tool.label !== "string" ||
        typeof tool.description !== "string" ||
        typeof tool.execute !== "function" ||
        !tool.parameters ||
        typeof tool.parameters !== "object" ||
        Array.isArray(tool.parameters) ||
        tools.has(tool.name)
      ) {
        throw new Error("Invalid or duplicate tool definition");
      }
      if (tool.prepareArguments) failAccess("prepareArguments");
      // Custom render functions are presentation-only for the purposes of this
      // worker. They are not executed here; the parent proxy uses Pi's generic
      // fallback rendering and records the fidelity loss explicitly.
      tool.customRendering = Boolean(tool.renderCall || tool.renderResult);
      tools.set(tool.name, tool);
    },
  },
  {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      return failAccess(`pi.${String(key)}`);
    },
  },
);

function metadata(): ToolMetadata[] {
  return [...tools.values()].map(tool => {
    const record: ToolMetadata = {
      name: tool.name,
      label: tool.label ?? tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
    if (tool.promptSnippet !== undefined) record.promptSnippet = tool.promptSnippet;
    if (tool.promptGuidelines !== undefined) record.promptGuidelines = tool.promptGuidelines;
    if (tool.executionMode !== undefined) record.executionMode = tool.executionMode;
    if (tool.constrainedSampling !== undefined) record.constrainedSampling = tool.constrainedSampling;
    if (tool.customRendering) record.customRendering = true;
    return record;
  });
}

process.on("message", async (message: any) => {
  if (message?.op === "cancel") {
    controllers.get(message.callId)?.abort();
    return;
  }

  const { id, op } = message ?? {};
  try {
    if (op === "load") {
      if (loaded) throw new Error("A worker hosts exactly one package");

      const workerAliases = { ...alias };
      if (message.lazySdk) {
        // Compatibility is resolved against MoAH-owned worker shims. There is
        // intentionally no automatic fallback to the full upstream Pi SDK.
      }

      const jiti = createJiti(import.meta.url, {
        alias: workerAliases,
        moduleCache: false,
        fsCache: false,
      });
      const factory = await jiti.import(message.entry, { default: true }) as any;
      if (typeof factory !== "function") throw new Error("Pi extension must export a default factory");
      await factory(api);
      if (unsupported.size) throw new Error(`Unsupported extension APIs: ${[...unsupported].join(", ")}`);
      if (!tools.size) throw new Error("Extension registered no tools");
      loaded = true;
      send({ id, result: { tools: metadata(), rss: process.memoryUsage().rss, pid: process.pid } });
      return;
    }

    if (op === "call") {
      const tool = tools.get(message.name);
      if (!loaded || !tool) throw new Error(`Tool not loaded: ${message.name}`);

      const controller = new AbortController();
      controllers.set(id, controller);
      const ctx = new Proxy(
        { cwd: message.cwd, hasUI: false, signal: controller.signal },
        {
          get(target, key) {
            if (key in target) return target[key as keyof typeof target];
            return failAccess(`ctx.${String(key)}`);
          },
        },
      );

      try {
        const result = await tool.execute(
          message.callId,
          message.args,
          controller.signal,
          (update: unknown) => send({ id, update }),
          ctx,
        );
        if (!result || !Array.isArray(result.content)) throw new Error("Invalid Pi tool result");
        send({ id, result, rss: process.memoryUsage().rss });
      } finally {
        controllers.delete(id);
      }
      return;
    }

    if (op === "memory") {
      send({ id, result: { rss: process.memoryUsage().rss } });
      return;
    }

    if (op === "ping") {
      send({ id, result: { rss: process.memoryUsage().rss } });
      return;
    }

    if (op === "shutdown") {
      send({ id, result: { ok: true } });
      process.exit(0);
      return;
    }

    throw new Error(`Unknown worker operation: ${op}`);
  } catch (error) {
    send({
      id,
      error: error instanceof Error ? error.message : String(error),
      rss: process.memoryUsage().rss,
    });
  }
});

process.on("disconnect", () => process.exit(0));
