import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ToolProcess } from "../src/process-client.js";
import { writeJson } from "../src/config.js";

const measurements = [];
let baseline: unknown;
for (let repetition = 0; repetition < 2; repetition++) {
  for (const lazySdk of repetition ? [true, false] : [false, true]) {
    const worker = new ToolProcess(process.cwd());
    try {
      const start = performance.now();
      const result = await worker.request("load", { entry: resolve("node_modules/@bitcraft-apps/pi-web-tools/index.ts"), lazySdk }, 30000);
      baseline ??= result.tools;
      assert.deepEqual(result.tools, baseline);
      measurements.push({ repetition, lazySdk, loadMs: performance.now() - start, workerRssBytes: result.rss });
    } finally { await worker.close(); }
  }
}
await writeJson(".moah/sdk-profile.json", { capturedAt: new Date().toISOString(), sameToolMetadata: true, measurements });
console.log(JSON.stringify(measurements, null, 2));
