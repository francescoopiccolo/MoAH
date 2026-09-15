import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { buildCatalog, readCatalog } from "../src/catalog.js";
import { ProcessPool } from "../src/pool.js";
import { fixtureConfig, temporaryDirectory } from "./helpers.js";
import { ToolProcess } from "../src/process-client.js";

test("worker startup failure rejects requests and closes without hanging", { timeout: 10000 }, async () => {
  const worker = new ToolProcess(resolve(".moah/nonexistent-worker-directory"));
  try { await assert.rejects(worker.request("memory", {}, 2000)); }
  finally { await worker.close(); }
});

test("real process loads only on demand, reuses memory and exits on release", { timeout: 60000 }, async () => {
  const config = await fixtureConfig(); const tmp = await temporaryDirectory();
  const events: string[] = [];
  const catalog = await buildCatalog(config, tmp.path);
  const pool = new ProcessPool(catalog, tmp.path, config.cache, event => events.push(event));
  try {
    assert.deepEqual(pool.snapshot(), []);
    let updates = 0;
    const first = await pool.execute("search_remote", {}, "one", undefined, () => updates++);
    const second = await pool.execute("inspect_db", {}, "two");
    assert.equal(first.details.pid, second.details.pid);
    assert.equal(first.details.cwd, tmp.path);
    assert.ok(updates > 0);
    assert.ok(pool.snapshot()[0].rss > 16 * 1024 ** 2);
    assert.ok(events.includes("cache_hit"));
    await pool.close();
    assert.deepEqual(pool.snapshot(), []);
    assert.throws(() => process.kill(first.details.pid, 0));
  } finally { await pool.close(); await tmp.cleanup(); }
});
test("memory budget evicts idle code and later reloads the original tool", { timeout: 60000 }, async () => {
  const config = await fixtureConfig(); const tmp = await temporaryDirectory();
  const catalog = await buildCatalog(config, tmp.path);
  const pool = new ProcessPool(catalog, tmp.path, { ...config.cache, residentBudgetMb: 1 });
  try {
    const first = await pool.execute("inspect_db", {}, "one");
    assert.deepEqual(pool.snapshot(), []);
    const second = await pool.execute("inspect_db", {}, "two");
    assert.notEqual(first.details.pid, second.details.pid);
  } finally { await pool.close(); await tmp.cleanup(); }
});
test("busy workers remain pinned; cancellation terminates without replay", { timeout: 60000 }, async () => {
  const config = await fixtureConfig(); const tmp = await temporaryDirectory();
  const catalog = await buildCatalog(config, tmp.path);
  const pool = new ProcessPool(catalog, tmp.path, { ...config.cache, idleTtlMs: 20 });
  const controller = new AbortController();
  try {
    await pool.warm(["search_remote"]);
    let started!: () => void;
    const running = new Promise<void>(r => { started = r; });
    const call = pool.execute("search_remote", { delay: 10000 }, "one", controller.signal, started);
    const rejection = assert.rejects(call, /aborted|closed/);
    await running;
    await delay(60);
    assert.equal(pool.snapshot()[0].busy, 1);
    controller.abort();
    await rejection;
  } finally { await pool.close(); await tmp.cleanup(); }
});
test("timeout kills the process and rejects the call", { timeout: 60000 }, async () => {
  const config = await fixtureConfig(); const tmp = await temporaryDirectory();
  const catalog = await buildCatalog(config, tmp.path);
  const pool = new ProcessPool(catalog, tmp.path, { ...config.cache, callTimeoutMs: 50 });
  try { await assert.rejects(pool.execute("search_remote", { delay: 5000 }, "one"), /timeout/); }
  finally { await pool.close(); await tmp.cleanup(); }
});

test("phase release retains a shared package and never kills an in-flight call", { timeout: 60000 }, async () => {
  const config = await fixtureConfig(); const tmp = await temporaryDirectory();
  const catalog = await buildCatalog(config, tmp.path);
  const pool = new ProcessPool(catalog, tmp.path, config.cache);
  try {
    await pool.warm(["search_remote"]);
    const pid = pool.snapshot()[0].pid!;
    await pool.releaseUnused(["inspect_db"]);
    assert.equal(pool.snapshot()[0].pid, pid, "both tools share the same package");
    let started!: () => void;
    const running = new Promise<void>(r => { started = r; });
    const call = pool.execute("search_remote", { delay: 300 }, "busy", undefined, started);
    await running;
    await pool.releaseUnused([]);
    assert.equal(pool.snapshot()[0].busy, 1);
    await call;
    await pool.releaseUnused([]);
    assert.deepEqual(pool.snapshot(), []);
    assert.throws(() => process.kill(pid, 0));
  } finally { await pool.close(); await tmp.cleanup(); }
});
test("session-bound extensions are rejected during indexing", { timeout: 30000 }, async () => {
  const worker = new ToolProcess(process.cwd());
  try { await assert.rejects(worker.request("load", { entry: resolve("test/fixtures/unsupported.mjs") }, 20000), /Unsupported extension APIs/); }
  finally { await worker.close(); }
});
test("changed sources invalidate the catalog before execution", { timeout: 30000 }, async () => {
  const config = await fixtureConfig(); const tmp = await temporaryDirectory();
  const entry = join(tmp.path, "tools.mjs");
  await copyFile(resolve("test/fixtures/tools.mjs"), entry);
  config.packages[0].entry = entry;
  try {
    await buildCatalog(config, tmp.path);
    await writeFile(entry, "export default () => {};\n");
    await assert.rejects(readCatalog(config, tmp.path), /changed/);
  } finally { await tmp.cleanup(); }
});
