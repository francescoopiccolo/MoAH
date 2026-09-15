import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";
import { ToolProcess } from "./process-client.js";
import { stateDir, writeJson } from "./config.js";
import type { Config, IndexedPackage, PackageSpec, ToolMetadata } from "./types.js";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export async function sourceFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (["node_modules", ".git", ".moah"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in streamed package sources: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        hash.update(relative(root, path).split(sep).join("/")); hash.update("\0");
        for await (const chunk of createReadStream(path)) hash.update(chunk);
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

export async function resolvePackage(spec: PackageSpec, cwd: string): Promise<{ entry: string; root: string }> {
  let root: string;
  if (spec.package) {
    const require = createRequire(join(cwd, "package.json"));
    let dir: string | undefined;
    // Resource-only Pi packages need not export a JS entry point.
    const runtimeRequire = createRequire(import.meta.url);
    for (const base of [...new Set([...(require.resolve.paths(spec.package) ?? []), ...(runtimeRequire.resolve.paths(spec.package) ?? [])])]) {
      try {
        const candidate = join(base, spec.package);
        const manifest = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
        if (manifest.name === spec.package) { dir = candidate; break; }
      } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    dir ??= dirname(require.resolve(spec.package));
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
        if (manifest.name === spec.package) {
          if (manifest.version !== spec.version) throw new Error(`Expected ${spec.package}@${spec.version}, found ${manifest.version}`);
          root = dir; break;
        }
      } catch (error: any) { if (error.code !== "ENOENT") throw error; }
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

export async function buildCatalog(config: Config, cwd: string): Promise<IndexedPackage[]> {
  const packages: IndexedPackage[] = [];
  const names = new Set<string>();
  const manager = new DefaultPackageManager({ cwd, agentDir: join(stateDir(cwd), "index-runtime"), settingsManager: SettingsManager.inMemory() });
  for (const spec of config.packages) {
    const emptyResources = () => ({ extensions: [], skills: [], prompts: [], themes: [] });
    let source: { entry: string; root: string };
    try { source = await resolvePackage(spec, cwd); }
    catch (error) {
      packages.push({ id: spec.id, entry: "", root: "", fingerprint: "", tools: [], mode: "unavailable",
        nativeSource: "", context: "preserve", resources: emptyResources(), reason: String(error) });
      continue;
    }
    let nativeSource = source.entry;
    // Pass full package roots to Pi so skills, prompts, themes and extra extensions survive.
    try { const manifest = JSON.parse(await readFile(join(source.root, "package.json"), "utf8")); if (manifest.pi) nativeSource = source.root; }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    const resolved = await manager.resolveExtensionSources([nativeSource], { temporary: true });
    const resources: IndexedPackage["resources"] = {
      extensions: resolved.extensions.filter(r => r.enabled).map(r => r.path),
      skills: resolved.skills.filter(r => r.enabled).map(r => r.path),
      prompts: resolved.prompts.filter(r => r.enabled).map(r => r.path),
      themes: resolved.themes.filter(r => r.enabled).map(r => r.path),
    };
    const pkg: IndexedPackage = { id: spec.id, ...source, nativeSource, resources, fingerprint: "", tools: [], workerSdk: spec.workerSdk ?? "full",
      mode: "native", context: spec.context ?? "preserve", reason: "Native Pi lifecycle preserved" };
    packages.push(pkg);
    if (spec.mode === "native" || spec.stateless !== true) continue;
    if (resources.extensions.length !== 1 || (await realpath(resources.extensions[0])) !== source.entry) {
      pkg.reason = "Package has multiple or directory extension entry points; delegated intact to Pi";
      continue;
    }
    const worker = new ToolProcess(cwd);
    try {
      const result = await worker.request("load", { entry: source.entry, lazySdk: spec.workerSdk === "lazy" }, config.cache.loadTimeoutMs);
      const tools = result.tools as ToolMetadata[];
      if (tools.some(tool => names.has(tool.name) || tool.name.startsWith("moah_"))) throw new Error("Tool name collision; resolve through native Pi diagnostics");
      pkg.fingerprint = await sourceFingerprint(source.root);
      pkg.tools = tools; pkg.mode = "stream"; pkg.context = "dynamic";
      pkg.reason = "Stateless contract declared; worker registration probe passed";
      for (const tool of tools) names.add(tool.name);
    } catch (error) {
      // A failed streaming probe is not an exclusion or proof of a broken Pi package.
      pkg.reason = `Native fallback after worker probe: ${error instanceof Error ? error.message : String(error)}`;
    } finally { await worker.close(); }
  }
  await writeJson(join(stateDir(cwd), "catalog.json"), {
    schema: 2, piVersion: "0.85.1", specs: config.packages,
    lockHash: await lockHash(cwd), packages,
  });
  return packages;
}
async function lockHash(cwd: string): Promise<string> {
  try { return createHash("sha256").update(await readFile(join(cwd, "package-lock.json"))).digest("hex"); }
  catch (error: any) { if (error.code === "ENOENT") return "none"; throw error; }
}
export async function readCatalog(config: Config, cwd: string): Promise<IndexedPackage[]> {
  if (!config.packages.length) return [];
  const raw = JSON.parse(await readFile(join(stateDir(cwd), "catalog.json"), "utf8").catch(() => {
    throw new Error("Catalog missing. Run: moah index");
  }));
  if (raw.schema !== 2 || raw.piVersion !== "0.85.1" || JSON.stringify(raw.specs) !== JSON.stringify(config.packages) || raw.lockHash !== await lockHash(cwd)) {
    throw new Error("Catalog/configuration/dependencies changed. Run: moah index");
  }
  for (const p of raw.packages as IndexedPackage[]) {
    if (p.mode === "stream" && await sourceFingerprint(p.root) !== p.fingerprint) throw new Error(`Package ${p.id} changed. Rebuild the catalog.`);
  }
  return raw.packages;
}

export function nativeArguments(catalog: IndexedPackage[], dense = false): string[] {
  const args: string[] = [];
  for (const p of catalog) {
    if (p.mode === "unavailable") continue;
    if (dense || p.mode === "native") args.push("-e", p.nativeSource);
    else {
      for (const path of p.resources.skills) args.push("--skill", path);
      for (const path of p.resources.prompts) args.push("--prompt-template", path);
      for (const path of p.resources.themes) args.push("--theme", path);
    }
  }
  return args;
}
