import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "./types.js";

export function defaultConfig(): Config {
  return {
    baseline: { enabled: true },
    router: {
      enabled: true,
      mode: "auto",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyEnv: "MOAH_ROUTER_API_KEY",
      maxTools: 6,
      baseTools: ["read", "bash", "powershell", "edit", "write"],
    },
    streaming: {
      enabled: true,
      prefetch: true,
      cold: false,
      hotPreload: 0,
      maxProcesses: 2,
      residentBudgetMb: 512,
      idleTtlMs: 120000,
      loadTimeoutMs: 30000,
      callTimeoutMs: 120000,
      estimatedRssMb: 64,
    },
    packages: [],
  };
}

export async function readConfig(file = resolve("moah.config.json")): Promise<Config> {
  const c = JSON.parse(await readFile(file, "utf8")) as Partial<Config>;
  if (!c || typeof c !== "object" || !Array.isArray(c.packages)) {
    throw new Error("Invalid moah.config.json structure");
  }

  const config: Config = {
    baseline: { enabled: true, ...(c.baseline ?? {}) },
    router: { ...defaultConfig().router, ...(c.router ?? {}) },
    streaming: { ...defaultConfig().streaming, ...(c.streaming ?? {}) },
    packages: c.packages ?? [],
  };

  if (typeof config.baseline.enabled !== "boolean") throw new Error("baseline.enabled must be a boolean");
  const r = config.router;
  if (
    typeof r.enabled !== "boolean" ||
    !["auto", "suggest", "oracle"].includes(r.mode) ||
    typeof r.baseUrl !== "string" || !/^https?:\/\//.test(r.baseUrl) ||
    typeof r.model !== "string" || !r.model.trim() ||
    typeof r.apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.apiKeyEnv) ||
    !Number.isInteger(r.maxTools) || r.maxTools < 1 ||
    !Array.isArray(r.baseTools) || r.baseTools.some(tool => typeof tool !== "string" || !tool.trim())
  ) {
    throw new Error("Invalid router configuration");
  }

  const s = config.streaming;
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  const nonNegativeInteger = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (
    typeof s.enabled !== "boolean" ||
    typeof s.prefetch !== "boolean" ||
    typeof s.cold !== "boolean" ||
    !nonNegativeInteger(s.hotPreload) ||
    !Number.isInteger(s.maxProcesses) || s.maxProcesses < 1 ||
    !positive(s.residentBudgetMb) ||
    !positive(s.idleTtlMs) ||
    !positive(s.loadTimeoutMs) ||
    !positive(s.callTimeoutMs) ||
    !positive(s.estimatedRssMb)
  ) {
    throw new Error("Invalid streaming configuration");
  }

  const ids = new Set<string>();
  for (const p of config.packages) {
    if (!p || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(p.id) || ids.has(p.id) ||
        typeof p.entry !== "string" || !p.entry) {
      throw new Error("Each package needs a unique id and an entry path");
    }
    if (p.package !== undefined && (typeof p.package !== "string" || typeof p.version !== "string")) {
      throw new Error("npm packages require both package and version");
    }
    if (p.provenance !== undefined && !["pi-official-example", "community-installed"].includes(p.provenance)) {
      throw new Error("Unsupported package provenance");
    }
    if (["nativeResident", "routerEligible"].some(key => (p as any)[key] !== undefined && typeof (p as any)[key] !== "boolean")) {
      throw new Error("Package flags must be booleans");
    }
    if (p.mode !== undefined && !["auto", "native", "stream"].includes(p.mode)) {
      throw new Error("package.mode must be auto, native, or stream");
    }
    if (p.stateless !== undefined && typeof p.stateless !== "boolean") {
      throw new Error("package.stateless must be a boolean");
    }
    if (p.workerSdk !== undefined && !["full", "lazy"].includes(p.workerSdk)) {
      throw new Error("package.workerSdk must be full or lazy");
    }
    if (p.mode === "stream" && p.stateless === false) {
      throw new Error("package.mode=stream requires package.stateless=true");
    }
    ids.add(p.id);
  }

  return config;
}

export function stateDir(cwd: string): string {
  return join(cwd, ".moah");
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, file);
}
