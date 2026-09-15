import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeJson } from "../src/config.js";
const root = resolve(process.argv[2]);
const comparison = JSON.parse(await readFile(join(root, "comparison.json"), "utf8"));
const rows = [];
for (const run of comparison.results) {
  const traceDir = join(run.workspace, ".moah", "traces");
  const events: any[] = [];
  for (const name of await readdir(traceDir).catch(() => [])) for (const line of (await readFile(join(traceDir, name), "utf8")).split(/\r?\n/)) {
    try { events.push(JSON.parse(line)); } catch { /* incomplete line */ }
  }
  const eviction = events.find(e => e.event === "evict");
  const memory = (await readFile(join(run.workspace, "memory-samples.jsonl"), "utf8").catch(() => "")).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const after = eviction ? memory.filter(m => typeof m.workingSetBytes === "number" && typeof m.time === "number" && m.time > Date.parse(eviction.time)) : [];
  const agentEvents = (await readFile(join(run.workspace, "agent-events.jsonl"), "utf8")).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const coreStart = agentEvents.find(e => e.type === "message_end" && e.message?.role === "assistant" && e.message.content?.some((c: any) => c.type === "toolCall" && c.id === "step_1"))?.message.timestamp;
  const core = typeof coreStart === "number" ? memory.filter(m => typeof m.workingSetBytes === "number" && m.time >= coreStart) : [];
  rows.push({ mode: run.mode, passed: run.passed, requests: run.wire.requests.length, inputBytes: run.serializedInputBytes,
    sampledPeakMiB: run.memory.sampledPeakWorkingSetBytes / 1024 ** 2,
    postEvictionSamples: after.length, meanPostEvictionMiB: after.length ? after.reduce((n, m) => n + m.workingSetBytes, 0) / after.length / 1024 ** 2 : null,
    corePhaseSamples: core.length, meanCorePhaseMiB: core.length ? core.reduce((n, m) => n + m.workingSetBytes, 0) / core.length / 1024 ** 2 : null });
}
await writeJson(join(root, "summary.json"), { schemasMatch: comparison.schemasMatch, rows });
console.log(JSON.stringify(rows, null, 2));
