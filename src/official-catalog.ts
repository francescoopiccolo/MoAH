import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PI_COMMIT, PI_VERSION } from "./corpus.js";

export type CapabilityKind = "tool" | "command" | "hook" | "policy" | "tool-override" | "resource";
export type Activation = "tool" | "manual";

export interface OfficialCapability {
  id: string;
  name: string;
  description: string;
  kind: CapabilityKind;
  activation: Activation;
  sourcePath: string;
  provenance: "pi-core" | "pi-official-example";
  conflicts: string[];
}

export interface OfficialCatalog {
  schema: 1;
  pi: { commit: string; tag: string };
  capabilities: OfficialCapability[];
}

function resolveDataRoot(): string {
  const candidates = [
    new URL("../data/", import.meta.url),
    new URL("../../data/", import.meta.url),
  ].map(url => fileURLToPath(url));
  return candidates.find(dir => existsSync(dir)) ?? candidates[0];
}

const DATA_ROOT = resolveDataRoot();
const CATALOG_FILE = `${DATA_ROOT}/official-catalog.json`;

const KINDS = new Set<CapabilityKind>(["tool", "command", "hook", "policy", "tool-override", "resource"]);
const ACTIVATIONS = new Set<Activation>(["tool", "manual"]);
const PROVENANCES = new Set(["pi-core", "pi-official-example"]);

export async function readOfficialCatalog(): Promise<OfficialCatalog> {
  const catalog = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as OfficialCatalog;
  if (
    catalog.schema !== 1 ||
    catalog.pi.commit !== PI_COMMIT ||
    catalog.pi.tag !== `v${PI_VERSION}` ||
    !Array.isArray(catalog.capabilities) ||
    catalog.capabilities.length === 0
  ) {
    throw new Error("Invalid official catalog structure");
  }

  const ids = new Set<string>();
  for (const capability of catalog.capabilities) {
    if (
      !capability ||
      typeof capability.id !== "string" ||
      typeof capability.name !== "string" ||
      typeof capability.description !== "string" ||
      !KINDS.has(capability.kind) ||
      !ACTIVATIONS.has(capability.activation) ||
      typeof capability.sourcePath !== "string" ||
      !PROVENANCES.has(capability.provenance) ||
      !Array.isArray(capability.conflicts) ||
      capability.conflicts.some(name => typeof name !== "string") ||
      ids.has(capability.id)
    ) {
      throw new Error(`Invalid official capability: ${capability?.id ?? "unknown"}`);
    }
    ids.add(capability.id);
  }

  return catalog;
}

export function catalogForRouter(catalog: OfficialCatalog, baseTools: string[]) {
  const base = new Set(baseTools);
  return catalog.capabilities
    .filter(capability => capability.activation === "tool" && !base.has(capability.name))
    .map(capability => ({
      name: capability.name,
      description: capability.description,
      kind: capability.kind,
      conflicts: capability.conflicts,
    }));
}
