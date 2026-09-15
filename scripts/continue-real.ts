import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runBenchmark, runBounded } from "../src/benchmark.js";

for (const suite of process.argv.slice(2)) {
  const report = await runBenchmark(suite, false);
  assert.ok("results" in report);
  const audit = await runBounded(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./audit-openrouter.ts", import.meta.url)), report.runRoot], process.cwd(), 120000);
  console.log(audit.stdout); if (audit.code !== 0) console.error(audit.stderr);
  const summary = await runBounded(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./summarize-real.ts", import.meta.url)), report.runRoot], process.cwd(), 15000);
  console.log(summary.stdout); if (summary.code !== 0) console.error(summary.stderr);
}
