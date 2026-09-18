import { readFile, stat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";
import { stateDir, writeJson } from "./config.js";
import type { Config, IndexedPackage, PackageSpec } from "./types.js";
import { PI_VERSION, baselinePackageSpecs, sha256, trustedManifestMatch } from "./corpus.js";

export async function resolvePackage(spec: PackageSpec, cwd: string): Promise<{ entry: string; root: string }> {
  let root: string;
  if (spec.package) {
    const require = createRequire(join(cwd, "package.json"));
    let dir: string | undefined;
    const runtimeRequire = createRequire(import.meta.url);
    for (const base of [...new Set([...(require.resolve.paths(spec.package) ?? []), ...(runtimeRequire.resolve.paths(spec.package) ?? [])])]) {
      try {
        const candidate = join(base, spec.package);
        const manifest = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
        if (manifest.name === spec.package) {
          dir = candidate;
          break;
        }
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    dir ??= dirname(require.resolve(spec.package));
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
        if (manifest.name === spec.package) {
          if (manifest.version !== spec.version) throw new Error(`Expected ${spec.package}@${spec.version}, found ${manifest.version}`);
          root = dir;
          break;
        }
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      if (dirname(dir) === dir) throw new Error(`Cannot find package root for ${spec.package}`);
      dir = dirname(dir);
    }
  } else {
    const target = resolve(cwd, spec.entry);
    root = (await stat(target)).isDirectory() ? target : dirname(target);
  }
  root = await realpath(root);
  const entry = await realpath(spec.package ? resolve(root, spec.entry) : resolve(cwd, spec.entry));
  const rel = relative(root, entry);
  if (rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) throw new Error("Entry must be inside the package");
  return { entry, root };
}

export async function effectivePackageSpecs(config: Config): Promise<PackageSpec[]> {
  const baseline = config.baseline.enabled ? await baselinePackageSpecs() : [];
  const ids = new Set<string>();
  for (const spec of [...baseline, ...config.packages]) {
    if (ids.has(spec.id)) throw new Error(`Duplicate package id after baseline expansion: ${spec.id}`);
    ids.add(spec.id);
  }
  return [...baseline, ...config.packages];
}

async function lockHash(cwd: string): Promise<string> {
  try {
    return createHash("sha256").update(await readFile(join(cwd, "package-lock.json"))).digest("hex");
  } catch (error: any) {
    if (error.code === "ENOENT") return "none";
    throw error;
  }
}

export async function buildCatalog(config: Config, cwd: string): Promise<IndexedPackage[]> {
  const packages: IndexedPackage[] = [];
  const specs = await effectivePackageSpecs(config);

  for (const spec of specs) {
    const base: IndexedPackage = {
      id: spec.id,
      corpusId: spec.corpusId,
      entry: "",
      root: "",
      nativeSource: "",
      mode: "unavailable",
      provenance: spec.provenance ?? "community-installed",
      autoAcquire: false,
      nativeResident: !!spec.nativeResident,
      routerEligible: spec.routerEligible !== false,
      sourceHash: spec.sourceHash,
      sourceCommit: spec.sourceCommit,
      reason: "Unavailable",
    };

    let source: { entry: string; root: string };
    try {
      source = await resolvePackage(spec, cwd);
    } catch (error) {
      base.reason = error instanceof Error ? error.message : String(error);
      packages.push(base);
      continue;
    }

    let nativeSource = source.entry;
    try {
      const manifest = JSON.parse(await readFile(join(source.root, "package.json"), "utf8"));
      if (manifest.pi) nativeSource = source.root;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }

    const trusted = await trustedManifestMatch(spec);
    if (spec.sourceHash && spec.sourceHash !== await sha256(source.entry)) {
      base.reason = "Source hash does not match the configured immutable record";
      packages.push(base);
      continue;
    }
    if (spec.provenance === "pi-official-example" && !trusted) {
      base.reason = "First-party provenance was not verified against MoAH's bundled manifest";
      packages.push(base);
      continue;
    }

    const requiredExternalDependency: Record<string, string> = {
      "sandbox": "@anthropic-ai/sandbox-runtime",
      "gondolin": "@earendil-works/gondolin",
    };
    if (spec.corpusId && requiredExternalDependency[spec.corpusId]) {
      try {
        createRequire(import.meta.url).resolve(requiredExternalDependency[spec.corpusId]);
      } catch {
        base.reason = `Missing external dependency ${requiredExternalDependency[spec.corpusId]}`;
        packages.push(base);
        continue;
      }
    }

    packages.push({
      ...base,
      entry: source.entry,
      root: source.root,
      nativeSource,
      mode: "native",
      reason: spec.nativeResident
        ? "Native resident at startup; router can enable its tools in-session"
        : "On-disk official/user capability; Pi can load it manually or as configured",
    });
  }

  await writeJson(join(stateDir(cwd), "catalog.json"), {
    schema: 2,
    piVersion: PI_VERSION,
    specs,
    lockHash: await lockHash(cwd),
    packages,
  });
  return packages;
}

export async function readCatalog(config: Config, cwd: string): Promise<IndexedPackage[]> {
  const specs = await effectivePackageSpecs(config);
  if (!specs.length) return [];
  const raw = JSON.parse(await readFile(join(stateDir(cwd), "catalog.json"), "utf8").catch(() => {
    throw new Error("Catalog missing. Run: moah index");
  }));
  if (raw.schema !== 2 || raw.piVersion !== PI_VERSION || JSON.stringify(raw.specs) !== JSON.stringify(specs) || raw.lockHash !== await lockHash(cwd)) {
    throw new Error("Catalog/configuration/dependencies changed. Run: moah index");
  }
  return raw.packages as IndexedPackage[];
}

export function nativeArguments(catalog: IndexedPackage[], dense = false): string[] {
  const args: string[] = [];
  for (const pkg of catalog) {
    if (pkg.mode === "unavailable") continue;
    if (dense || pkg.nativeResident) args.push("-e", pkg.nativeSource);
  }
  return args;
}
