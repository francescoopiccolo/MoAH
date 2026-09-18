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
