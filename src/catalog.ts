import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";
import { stateDir, writeJson } from "./config.js";
import type { Config, IndexedPackage, PackageSpec, StreamingClass, ToolMetadata } from "./types.js";
import { PI_VERSION, baselinePackageSpecs, sha256, trustedManifestMatch } from "./corpus.js";
import { PackageWorkerClient } from "./streaming/package-worker-client.js";

export async function sourceFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function visit(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (["node_modules", ".git", ".moah"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in streamed package sources: ${path}`);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        hash.update(relative(root, path).split(sep).join("/"));
        hash.update("\0");
        for await (const chunk of createReadStream(path)) hash.update(chunk);
      }
    }
  }

  await visit(root);
  return hash.digest("hex");
}

function streamingClassFromSource(source: string): { contextAdapter: boolean; forbidden?: string } {
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\bctx\.ui\b/, "interactive ctx.ui"],
    [/\bctx\.sessionManager\b/, "ctx.sessionManager"],
    [/\bctx\.model\b/, "ctx.model"],
    [/\bctx\.modelRegistry\b/, "ctx.modelRegistry"],
    [/\bctx\.events\b/, "ctx.events"],
    [/\bctx\.abort\s*\(/, "ctx.abort"],
    [/\bctx\.shutdown\s*\(/, "ctx.shutdown"],
    [/\bctx\.sendUserMessage\b/, "ctx.sendUserMessage"],
    [/\bpi\.on\s*\(/, "lifecycle hooks"],
    [/\bpi\.registerCommand\s*\(/, "commands"],
    [/\bpi\.sendUserMessage\s*\(/, "pi.sendUserMessage"],
    [/\bpi\.exec\s*\(/, "pi.exec"],
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(source)) return { contextAdapter: false, forbidden: label };
  }

  const contextAdapter = /\bctx\.(cwd|hasUI|signal)\b/.test(source);
  return { contextAdapter };
}

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
  const names = new Set<string>();

  for (const spec of specs) {
    const base: IndexedPackage = {
      id: spec.id,
      corpusId: spec.corpusId,
      entry: "",
      root: "",
      nativeSource: "",
      mode: "native",
      provenance: spec.provenance ?? "community-installed",
      autoAcquire: false,
      nativeResident: !!spec.nativeResident,
      routerEligible: spec.routerEligible !== false,
      tools: [],
      workerSdk: spec.workerSdk ?? "lazy",
      sourceHash: spec.sourceHash,
      sourceCommit: spec.sourceCommit,
      reason: "Native Pi lifecycle preserved",
    };

    let source: { entry: string; root: string };
    try {
      source = await resolvePackage(spec, cwd);
    } catch (error) {
      base.reason = error instanceof Error ? error.message : String(error);
      base.mode = "unavailable";
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
      base.mode = "unavailable";
      packages.push(base);
      continue;
    }
    if (spec.provenance === "pi-official-example" && !trusted) {
      base.reason = "First-party provenance was not verified against MoAH's bundled manifest";
      base.mode = "unavailable";
      packages.push(base);
      continue;
    }
    if (trusted && spec.corpusId === "truncated-tool") {
      const sources = [
        new URL("../data/moah/rg.ts", import.meta.url),
        new URL("../../data/moah/rg.ts", import.meta.url),
      ].map(url => fileURLToPath(url));
      nativeSource = sources.find(path => existsSync(path)) ?? sources[0];
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
        base.mode = "unavailable";
        packages.push(base);
        continue;
      }
    }

    const resolved = {
      ...base,
      entry: source.entry,
      root: source.root,
      nativeSource,
    };

    const streamEligible = spec.mode !== "native" && (spec.stateless === true || spec.mode === "stream");
    if (!streamEligible) {
      packages.push({
        ...resolved,
        reason: spec.nativeResident
          ? "Native resident at startup; router can enable its tools in-session"
          : "On-disk official/user capability; Pi can load it manually or as configured",
      });
      continue;
    }

    const sourceText = await readFile(source.entry, "utf8");
    const staticClassification = streamingClassFromSource(sourceText);
    if (staticClassification.forbidden) {
      packages.push({
        ...resolved,
        mode: "native",
        tools: [],
        streamingClass: "NATIVE_REQUIRED",
        reason: `Native fallback after static scan: ${staticClassification.forbidden}`,
      });
      continue;
    }

    const entryStat = await stat(source.entry).catch(() => undefined);
    if (!entryStat?.isFile()) {
      packages.push({
        ...resolved,
        streamingClass: "NATIVE_REQUIRED",
        reason: "Streaming requires a single file entry; native Pi lifecycle preserved",
      });
      continue;
    }

    const worker = new PackageWorkerClient(cwd);
    try {
      const result = await worker.request(
        "load",
        { entry: source.entry, lazySdk: spec.workerSdk !== "full" },
        config.streaming.loadTimeoutMs,
      );
      const tools = result.tools as ToolMetadata[];
      if (tools.some(tool => names.has(tool.name) || tool.name.startsWith("moah_"))) {
        throw new Error("Tool name collision; resolve through native Pi diagnostics");
      }

      const fingerprint = await sourceFingerprint(source.root);
      for (const tool of tools) names.add(tool.name);
      const customRendering = tools.some(tool => tool.customRendering);
      const streamingClass: StreamingClass = staticClassification.contextAdapter
        ? "CONTEXT_ADAPTER_STREAMABLE"
        : customRendering
          ? "EXECUTION_STREAMABLE_WITH_GENERIC_RENDERING"
          : "EXACT_STREAMABLE";
      packages.push({
        ...resolved,
        mode: "stream",
        tools,
        workerSdk: spec.workerSdk ?? "lazy",
        sourceFingerprint: fingerprint,
        streamingClass,
        reason: streamingClass === "CONTEXT_ADAPTER_STREAMABLE"
          ? "Stateless contract declared; allowlisted context adapter and isolated worker probe passed"
          : streamingClass === "EXECUTION_STREAMABLE_WITH_GENERIC_RENDERING"
            ? "Execution isolated; custom rendering will use generic fallback in the parent proxy"
            : "Stateless contract declared; isolated worker probe passed",
      });
    } catch (error) {
      packages.push({
        ...resolved,
        mode: "native",
        tools: [],
        streamingClass: "NATIVE_REQUIRED",
        reason: `Native fallback after worker probe: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      await worker.close();
    }
  }

  await writeJson(join(stateDir(cwd), "catalog.json"), {
    schema: 3,
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
  if (raw.schema !== 3 || raw.piVersion !== PI_VERSION || JSON.stringify(raw.specs) !== JSON.stringify(specs) || raw.lockHash !== await lockHash(cwd)) {
    throw new Error("Catalog/configuration/dependencies changed. Run: moah index");
  }
  for (const pkg of raw.packages as IndexedPackage[]) {
    if (pkg.mode === "stream" && pkg.sourceFingerprint && await sourceFingerprint(pkg.root) !== pkg.sourceFingerprint) {
      throw new Error(`Package ${pkg.id} changed. Rebuild the catalog.`);
    }
  }
  return raw.packages as IndexedPackage[];
}

export function nativeArguments(catalog: IndexedPackage[], dense = false): string[] {
  const args: string[] = [];
  for (const pkg of catalog) {
    if (pkg.mode === "unavailable") continue;
    if (dense || (pkg.mode === "native" && pkg.nativeResident)) args.push("-e", pkg.nativeSource);
  }
  return args;
}
