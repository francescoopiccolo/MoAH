import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeJson } from "../src/config.js";

// Reads only metadata for the generations present in this benchmark's event logs.
const root = resolve(process.argv[2] ?? "");
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is required in the process environment");
const report = JSON.parse(await readFile(join(root, "results.json"), "utf8"));
const generations = new Map<string, Record<string, unknown>>();
const results = [];
for (const run of report.results) {
  const events = (await readFile(join(run.workspace, "agent-events.jsonl"), "utf8")).split(/\r?\n/).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  // Include unfinished streamed responses so timed-out requests remain auditable.
  const ids = [...new Set<string>(events.flatMap(e => [e.message?.responseId, e.assistantMessageEvent?.partial?.responseId]).filter((id): id is string => typeof id === "string" && id.startsWith("gen-")))];
  for (const id of ids) {
    if (generations.has(id)) continue;
    try {
      const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) { generations.set(id, { id, error: `HTTP ${response.status}` }); continue; }
      const { data } = await response.json() as any;
      generations.set(id, Object.fromEntries(["id", "model", "provider_name", "total_cost", "native_tokens_prompt", "native_tokens_completion", "native_tokens_cached", "latency", "generation_time", "cancelled", "finish_reason"].map(k => [k, data[k] ?? null])));
    } catch { generations.set(id, { id, error: "Metadata request failed or timed out" }); }
  }
  const records = ids.map(id => generations.get(id)!);
  results.push({ task: run.task, mode: run.mode, repetition: run.repetition, generations: records,
    observedCostUsd: records.length && records.every(r => typeof r.total_cost === "number") ? records.reduce((n, r) => n + Number(r.total_cost), 0) : null,
    providers: [...new Set(records.map(r => r.provider_name).filter(Boolean))],
    completeness: run.timedOut ? "May omit requests interrupted before a generation ID was received" : "Covers generation IDs present in the event log",
  });
  console.log(`Audited ${run.task} / ${run.mode}: ${ids.length} generations`);
}
await writeJson(join(root, "openrouter-usage.json"), { capturedAt: new Date().toISOString(), results });
console.log(`Saved metadata audit to ${join(root, "openrouter-usage.json")}`);
