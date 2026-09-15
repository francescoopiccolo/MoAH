import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "./types.js";

/** Portable first-run settings; semantic retrieval remains optional. */
export function defaultConfig(): Config {
  return {
    selection: { maxActiveTools: 6, catalogPageSize: 40, descriptionCharacters: 200, resetOnPrompt: true, releaseInactive: true },
    router: { enabled: false, model: "Xenova/multilingual-e5-small", device: "cpu", dtype: "q8", topK: 2, minimumScore: 0.2, keepMargin: 0.01,
      pinnedTools: ["read", "bash", "powershell", "edit", "write"], maxQueryCharacters: 2400 },
    cache: { maxProcesses: 2, residentBudgetMb: 768, idleTtlMs: 120000, loadTimeoutMs: 30000, callTimeoutMs: 120000 },
    packages: [{ id: "pi-web-tools", package: "@bitcraft-apps/pi-web-tools", version: "1.6.0", entry: "index.ts", stateless: true, workerSdk: "lazy" }],
  };
}

export async function readConfig(file = resolve("moah.config.json")): Promise<Config> {
  const c = JSON.parse(await readFile(file, "utf8")) as Config;
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!c.router || !c.cache || !Array.isArray(c.packages)) throw new Error("Invalid moah.config.json structure");
  if (c.selection !== undefined && (!c.selection || typeof c.selection !== "object" || Array.isArray(c.selection))) throw new Error("Invalid selection configuration");
  c.selection = Object.assign({ maxActiveTools: 6, catalogPageSize: 40, descriptionCharacters: 200,
    resetOnPrompt: true, releaseInactive: true }, c.selection);
  c.router.enabled ??= true;
  for (const key of ["maxActiveTools", "catalogPageSize", "descriptionCharacters"] as const) {
    if (!positive(c.selection[key]) || !Number.isInteger(c.selection[key])) throw new Error(`Invalid selection.${key}`);
  }
  if (typeof c.selection.resetOnPrompt !== "boolean" || typeof c.selection.releaseInactive !== "boolean" ||
      typeof c.router.enabled !== "boolean") throw new Error("Invalid selection/router switches");
  if (typeof c.router.model !== "string" || !c.router.model.length ||
      !["cpu", "dml", "cuda"].includes(c.router.device) || !["q8", "fp32"].includes(c.router.dtype) ||
      !Number.isInteger(c.router.topK) || c.router.topK < 1 ||
      !positive(c.router.maxQueryCharacters) || !Number.isInteger(c.router.maxQueryCharacters) ||
      !Number.isFinite(c.router.minimumScore) || c.router.minimumScore < -1 || c.router.minimumScore > 1 ||
      !Number.isFinite(c.router.keepMargin) || c.router.keepMargin < 0 || c.router.keepMargin > 1 ||
      !Array.isArray(c.router.pinnedTools) || c.router.pinnedTools.some(n => typeof n !== "string")) {
    throw new Error("Invalid router configuration");
  }
  for (const key of ["maxProcesses", "residentBudgetMb", "idleTtlMs", "loadTimeoutMs", "callTimeoutMs"] as const) {
    if (!positive(c.cache[key])) throw new Error(`Invalid cache.${key}`);
  }
  if (!Number.isInteger(c.cache.maxProcesses)) throw new Error("cache.maxProcesses must be an integer");
  const ids = new Set<string>();
  for (const p of c.packages) {
    if (!p || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(p.id) || ids.has(p.id) ||
        typeof p.entry !== "string" || !p.entry ||
        (p.stateless !== undefined && typeof p.stateless !== "boolean") ||
        (p.mode !== undefined && !["auto", "native", "stream"].includes(p.mode)) ||
        (p.context !== undefined && !["preserve", "dynamic"].includes(p.context)) ||
        (p.workerSdk !== undefined && !["full", "lazy"].includes(p.workerSdk)) ||
        (p.package !== undefined && (typeof p.package !== "string" || typeof p.version !== "string"))) {
      throw new Error("Each package needs a unique id, entry, valid mode/context and a pinned version for npm packages");
    }
    ids.add(p.id);
  }
  return c;
}
export function stateDir(cwd: string): string { return join(cwd, ".moah"); }
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, file);
}
