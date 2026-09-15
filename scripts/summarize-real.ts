import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { writeJson } from "../src/config.js";

for (const path of process.argv.slice(2)) {
  const root = resolve(path);
  const corrected = await readFile(join(root, "reverified-results.json"), "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return undefined; throw e; });
  const report = JSON.parse(corrected ?? await readFile(join(root, "results.json"), "utf8"));
  const audit = JSON.parse(await readFile(join(root, "openrouter-usage.json"), "utf8").catch(() => '{"results":[]}'));
  const rows = [];
  for (const task of [...new Set<string>(report.results.map((r: any) => r.task))]) for (const mode of report.modes) {
    const runs = report.results.filter((r: any) => r.task === task && r.mode === mode);
    if (!runs.length) continue;
    const mean = (get: (r: any) => number | null | undefined) => {
      const values = runs.map(get); return values.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) ? values.reduce((n: number, v: number) => n + v, 0) / values.length : null;
    };
    const audited = audit.results.filter((r: any) => r.task === task && r.mode === mode);
    const cost = audited.length === runs.length && audited.every((r: any) => typeof r.observedCostUsd === "number") ? audited.reduce((n: number, r: any) => n + r.observedCostUsd, 0) : null;
    rows.push({ task, mode, attempted: runs.length, passed: runs.filter((r: any) => r.passed).length,
      artifactsPassed: runs.filter((r: any) => r.verification.code === 0 && r.exitCode === 0 && !r.timedOut).length,
      modelErrorRuns: runs.filter((r: any) => r.usage.modelErrors.length > 0).length,
      meanElapsedSeconds: mean(r => r.elapsedMs / 1000), meanPreparationSeconds: mean(r => r.preparationMs / 1000),
      meanInputTokens: mean(r => r.usage.input), meanCacheReadTokens: mean(r => r.usage.cacheRead), meanCacheWriteTokens: mean(r => r.usage.cacheWrite),
      meanOutputTokens: mean(r => r.usage.output), meanEstimatedCostUsd: mean(r => r.usage.estimatedCostUsd), auditedTotalCostUsd: cost,
      providers: [...new Set(audited.flatMap((r: any) => r.providers))],
      meanResponses: mean(r => r.usage.responses), meanSchemaBytesPerRequest: mean(r => r.providerRequests?.length ? r.providerRequests.reduce((n: number, p: any) => n + p.schemaBytes, 0) / r.providerRequests.length : null),
      meanSampledPeakWorkingSetMiB: mean(r => r.memory?.sampledPeakWorkingSetBytes == null ? null : r.memory.sampledPeakWorkingSetBytes / 1024 ** 2),
      pauses: runs.reduce((n: number, r: any) => n + r.controlRepeatPauses, 0), timeouts: runs.filter((r: any) => r.timedOut).length });
  }
  await writeJson(join(root, "summary.json"), { model: report.model, name: report.name, resultsSource: corrected ? "reverified-results.json" : "results.json", rows, note: "All attempts included; small observational sample, natural provider cache; no human time measured" });
  console.log(JSON.stringify({ root, rows }, null, 2));
}
