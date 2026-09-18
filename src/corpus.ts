import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { PackageSpec } from "./types.js";

export const PI_VERSION = "0.85.1";
export const PI_COMMIT = "d981de1229ef899957bbe968bc8dcda02a21f477";
function resolveDataRoot(): string {
  const candidates = [
    new URL("../data/", import.meta.url),
    new URL("../../data/", import.meta.url),
  ].map(url => fileURLToPath(url));
  return candidates.find(dir => existsSync(dir)) ?? candidates[0];
}

const DATA_ROOT = resolveDataRoot();
const MANIFEST = join(DATA_ROOT, "pi-official-capabilities.json");
const CORPUS_ROOT = join(DATA_ROOT, "corpus", "earendil-works-pi", PI_COMMIT, "extensions");

type ManifestRecord = {
  id: string;
  provenanceClass: string;
  sourcePath: string;
  sourceCommit: string;
  contentHash: string | null;
  name?: string;
  description?: string;
};

type Manifest = {
  schema: number;
  pi: { commit: string; tag: string };
  capabilities: ManifestRecord[];
};

let cached: Promise<Manifest> | undefined;

export async function officialManifest(): Promise<Manifest> {
  cached ??= readFile(MANIFEST, "utf8").then(text => {
    const manifest = JSON.parse(text) as Manifest;
    if (manifest.schema !== 1 || manifest.pi.commit !== PI_COMMIT || manifest.pi.tag !== `v${PI_VERSION}`) {
      throw new Error("Bundled official manifest does not match the supported Pi pin");
    }
    return manifest;
  });
  return cached;
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/**
 * Only these official examples are loaded natively by MoAH at startup.
 * Everything else stays on disk and can still be loaded manually by Pi.
 */
export const RESIDENT_CAPABILITY_IDS = new Set([
  "subagent",
  "todo",
  "question",
  "questionnaire",
  "structured-output",
  "truncated-tool",
  "reload-runtime",
]);

export async function baselinePackageSpecs(): Promise<PackageSpec[]> {
  const manifest = await officialManifest();
  return manifest.capabilities
    .filter(record => record.provenanceClass === "pi-official-example" && record.contentHash)
    .map(record => {
      const prefix = "packages/coding-agent/examples/extensions/";
      if (!record.sourcePath.startsWith(prefix)) throw new Error(`Invalid official corpus path: ${record.sourcePath}`);
      const entry = join(CORPUS_ROOT, record.sourcePath.slice(prefix.length));
      return {
        id: `pi-official-${record.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        corpusId: record.id,
        entry,
        provenance: "pi-official-example",
        nativeResident: RESIDENT_CAPABILITY_IDS.has(record.id),
        routerEligible: true,
        sourceCommit: record.sourceCommit,
        sourceHash: record.contentHash!,
        sourcePath: record.sourcePath,
      };
    });
}

export async function trustedManifestMatch(spec: PackageSpec): Promise<ManifestRecord | undefined> {
  if (spec.provenance !== "pi-official-example") return undefined;
  const manifest = await officialManifest();
  const record = manifest.capabilities.find(r => r.id === spec.corpusId && r.contentHash && r.sourceCommit === PI_COMMIT);
  if (!record) return undefined;
  const expected = resolve(CORPUS_ROOT, record.sourcePath.replace("packages/coding-agent/examples/extensions/", ""));
  return resolve(spec.entry) === expected && spec.sourceHash === record.contentHash ? record : undefined;
}
