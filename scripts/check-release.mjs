// Fresh npm installation outside the checkout: detects hidden ancestor dependencies.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const tarball = resolve(process.argv[2] ?? "missing-tarball");
const npmCli = process.env.npm_execpath ?? process.argv[3];
if (!npmCli) throw Error("Run through npm run test:package -- path/to/package.tgz");
const tempRoot = await realpath(tmpdir());
const dir = await mkdtemp(join(tempRoot, "moah-release-"));
const install = join(dir, "install"), project = join(dir, "project");
await mkdir(project);
function run(args, cwd, expect = 0) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 ** 2 });
  if (r.error || r.status !== expect) throw Error(`Release smoke failed (${r.status}): ${r.error ?? ""}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
try {
  console.log("Installing compiled tarball in a fresh external directory...");
  run([npmCli, "install", "--prefix", install, "--omit=dev", "--no-audit", "--no-fund", tarball], dir);
  const cli = join(install, "node_modules", "moah-ai", "bin", "moah.mjs");
  const workerClient = pathToFileURL(join(install, "node_modules", "moah-ai", "dist", "src", "streaming", "package-worker-client.js")).href;
  assert.match(run([cli, "help"], project), /MoAH — coding agent with automatic tool routing/);
  assert.match(run([cli, "about"], project), /MoAH \d+\.\d+\.\d+\r?\nAgent engine: Pi 0\.85\.1/);
  run(["--input-type=module", "--eval", `const { PackageWorkerClient } = await import(${JSON.stringify(workerClient)}); const worker = new PackageWorkerClient(${JSON.stringify(project)}); await worker.close();`], project);
  run([cli, "init"], project);
  const before = await readFile(join(project, "moah.config.json"), "utf8");
  run([cli, "init"], project, 1);
  assert.equal(await readFile(join(project, "moah.config.json"), "utf8"), before);
  assert.equal(JSON.parse(before).router.enabled, true);
  run([cli, "index"], project);
  const catalog = JSON.parse(await readFile(join(project, ".moah", "catalog.json"), "utf8"));
  const resident = catalog.packages.find(pkg => pkg.nativeResident);
  assert.ok(resident, "Expected at least one bundled resident capability");
  assert.equal(resident.mode, "native", resident.reason);
  const rg = catalog.packages.find(pkg => pkg.corpusId === "truncated-tool");
  assert.equal(rg?.mode, "native", rg?.reason);
  assert.match(rg.nativeSource, /data[\\/]moah[\\/]rg\.ts$/);
  assert.match(await readFile(rg.nativeSource, "utf8"), /execFileSync\("rg"/);
  run([cli, "catalog"], project);
  run([cli, "pi", "--help"], project);
  console.log("PASS: production-only install, compiled CLI, safe init and bundled package verification outside checkout.");
} finally {
  const rel = relative(tempRoot, await realpath(dir));
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !rel.startsWith("moah-release-")) throw Error("Unsafe release cleanup");
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
