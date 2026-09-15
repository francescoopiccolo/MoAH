import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { ToolProcess } from "../src/process-client.js";

test("lazy SDK preserves real upstream web tool definitions", { timeout: 60000 }, async () => {
  const definitions = [];
  for (const lazySdk of [false, true]) {
    const worker = new ToolProcess(process.cwd());
    try {
      const result = await worker.request("load", { entry: resolve("node_modules/@bitcraft-apps/pi-web-tools/index.ts"), lazySdk }, 30000);
      definitions.push(result.tools);
    } finally { await worker.close(); }
  }
  assert.deepEqual(definitions[1], definitions[0]);
});

test("lazy SDK delegates helpers and supports unlisted exports through the original SDK", { timeout: 90000 }, async () => {
  const require = createRequire(import.meta.url);
  const lazy = require(resolve("scripts/lazy-pi-sdk.cjs"));
  const original = await import("@earendil-works/pi-coding-agent");
  for (const bytes of [0, 1, 1024, 1024 ** 2]) assert.equal(lazy.formatSize(bytes), original.formatSize(bytes));
  const tool = { name: "identity" };
  assert.equal(lazy.defineTool(tool), tool);
  assert.equal(lazy.DEFAULT_MAX_LINES, original.DEFAULT_MAX_LINES);
});
