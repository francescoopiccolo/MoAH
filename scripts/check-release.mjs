// Fresh npm installation outside the checkout: detects hidden ancestor dependencies.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { spawnSync } from "node:child_process";

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
  const cli = join(install, "node_modules", "moah-pi", "bin", "moah.mjs");
  assert.match(run([cli, "help"], project), /API tool router|moah_select/);
  run([cli, "init"], project);
  const before = await readFile(join(project, "moah.config.json"), "utf8");
  run([cli, "init"], project, 1);
  assert.equal(await readFile(join(project, "moah.config.json"), "utf8"), before);
  assert.equal(JSON.parse(before).router.enabled, true);
  run([cli, "index"], project);
  const catalog = JSON.parse(await readFile(join(project, ".moah", "catalog.json"), "utf8"));
  assert.equal(catalog.packages[0].mode, "native", catalog.packages[0].reason);
  assert.equal(catalog.packages[0].nativeResident, true, catalog.packages[0].reason);
  run([cli, "catalog"], project);
  run([cli, "pi", "--help"], project);
  console.log("PASS: production-only install, compiled CLI, safe init and bundled package verification outside checkout.");
} finally {
  const rel = relative(tempRoot, await realpath(dir));
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !rel.startsWith("moah-release-")) throw Error("Unsafe release cleanup");
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
