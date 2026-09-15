import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRouter } from "../src/router.js";
import { fixtureConfig, temporaryDirectory } from "./helpers.js";
import type { Embedder } from "../src/types.js";

const embedder = (): Embedder => ({
  async embed(texts) { return texts.map(t => t.includes("database") ? [0, 1] : [1, 0]); },
  async dispose() {},
});
const candidates = [{ name: "read", description: "Read a file" }, { name: "web", description: "Search web" }, { name: "db", description: "Inspect database" }];

test("stateful selection changes while preserving pinned tools", async () => {
  const config = await fixtureConfig();
  const router = new ToolRouter(embedder(), config.router);
  assert.deepEqual((await router.route("web", candidates)).selected, ["read", "web"]);
  assert.deepEqual((await router.route("database", candidates)).selected, ["read", "db"]);
});
test("router never invents missing pinned tools", async () => {
  const config = await fixtureConfig();
  config.router.pinnedTools.push("production_deploy");
  const result = await new ToolRouter(embedder(), config.router).route("web", candidates);
  assert.ok(!result.selected.includes("production_deploy"));
});
test("no match and empty catalog are valid, duplicate names are rejected", async () => {
  const config = await fixtureConfig();
  const router = new ToolRouter(embedder(), config.router);
  assert.deepEqual((await router.route("database", [{ name: "web", description: "web" }])).selected, []);
  assert.deepEqual((await router.route("query", [])).selected, []);
  await assert.rejects(router.route("q", [candidates[0], candidates[0]]), /Duplicate/);
});
test("embedding errors are surfaced, not reported as successful routing", async () => {
  const config = await fixtureConfig();
  const router = new ToolRouter({ async embed() { throw new Error("offline model missing"); }, async dispose() {} }, config.router);
  await assert.rejects(router.route("web", candidates), /offline model missing/);
});
test("disk embeddings are reused and invalidated when descriptions change", async () => {
  const tmp = await temporaryDirectory();
  const config = await fixtureConfig();
  let count = 0;
  const tracked: Embedder = { async embed(texts) { count += texts.length; return embedder().embed(texts); }, async dispose() {} };
  try {
    await new ToolRouter(tracked, config.router, tmp.path).route("web", candidates);
    assert.equal(count, 4);
    await new ToolRouter(tracked, config.router, tmp.path).route("web", candidates);
    assert.equal(count, 5);
    await new ToolRouter(tracked, config.router, tmp.path).route("web", [...candidates, { name: "new", description: "new tool" }]);
    assert.equal(count, 10);
  } finally { await tmp.cleanup(); }
});
