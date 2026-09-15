import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { runBounded } from "../src/benchmark.js";
import { writeJson } from "../src/config.js";

const root = resolve(process.argv[2]);
const suite = JSON.parse(await readFile(resolve(process.argv[3]), "utf8"));
const original = JSON.parse(await readFile(join(root, "results.json"), "utf8"));
const originalSuite = JSON.parse(await readFile(join(root, "suite.json"), "utf8"));
const results = [];
for (const run of original.results) {
  const task = suite.tasks.find((t: any) => t.id === run.task);
  const before = originalSuite.tasks.find((t: any) => t.id === run.task);
  if (!task || JSON.stringify(task.prompts) !== JSON.stringify(before.prompts) || JSON.stringify(task.files) !== JSON.stringify(before.files)) throw new Error("Reverification may only change verifier, never task or fixtures");
  const verification = await runBounded(process.execPath, ["--input-type=module", "-e", task.verify], run.workspace, 15000);
  results.push({ ...run, originalPassed: run.passed, passed: run.exitCode === 0 && !run.timedOut && run.usage.responses > 0 && !run.usage.modelErrors.length && verification.code === 0 && !verification.timedOut,
    verification: { code: verification.code, output: verification.stdout, error: verification.stderr }, verifierSha256: createHash("sha256").update(task.verify).digest("hex") });
}
await writeJson(join(root, "reverified-results.json"), { ...original, results, reverification: { time: new Date().toISOString(), reason: "Correct escaped URL assertion syntax in verifier; unchanged agent outputs/prompts/fixtures; no additional model requests", suiteFile: resolve(process.argv[3]) } });
console.log(`Reverified ${results.length} runs; ${results.filter(r => r.passed).length} passed. Original results preserved.`);
