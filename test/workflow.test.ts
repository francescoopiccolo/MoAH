import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "./helpers.js";
import { measurePreparation } from "../src/workflow.js";

test("preparation timing preserves results/errors and never invents human effort", async () => {
  const tmp = await temporaryDirectory();
  try {
    assert.equal(await measurePreparation(tmp.path, "install", async () => 42), 42);
    const error = new Error("installer failed");
    await assert.rejects(measurePreparation(tmp.path, "install", async () => { throw error; }), e => e === error);
    const events = (await readFile(join(tmp.path, ".moah", "workflow-events.jsonl"), "utf8")).trim().split("\n").map(s => JSON.parse(s));
    assert.deepEqual(events.map(e => e.completed), [true, false]);
    assert.ok(events.every(e => e.humanActiveMs === null && e.elapsedMs >= 0));
  } finally { await tmp.cleanup(); }
});
