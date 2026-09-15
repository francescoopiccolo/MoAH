import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, stateDir, writeJson } from "../src/config.js";
import { buildCatalog, resolvePackage } from "../src/catalog.js";
import { ProcessPool } from "../src/pool.js";

const config = await readConfig("benchmarks/profiles/rich.json");
const original = process.cwd();
await mkdir(join(stateDir(original), "qualification"), { recursive: true });
const cwd = await mkdtemp(join(stateDir(original), "qualification", "rich-"));
config.packages = await Promise.all(config.packages.map(async p => ({ ...p, package: undefined, version: undefined, entry: (await resolvePackage(p, original)).entry })));
const catalog = await buildCatalog(config, cwd);
await writeFile(join(cwd, "sample.txt"), "MOAH_SENTINEL matched\n");
const traces: unknown[] = [];
const pool = new ProcessPool(catalog, cwd, config.cache, (event, data) => traces.push({ event, ...data }));
try {
  const result = await pool.execute("rg", { pattern: "MOAH_SENTINEL", path: "sample.txt" }, "qualification");
  assert.ok(!result.isError); assert.match(JSON.stringify(result.content), /MOAH_SENTINEL matched/);
  await pool.releaseUnused([]);
  assert.equal(pool.snapshot().length, 0);
  await writeJson(join(cwd, "result.json"), { passed: true, tool: "original Pi ripgrep example", catalog: catalog.map(p => ({ id: p.id, mode: p.mode })), traces });
  console.log(`Original ripgrep execution and release passed: ${cwd}`);
} finally { await pool.close(); }
