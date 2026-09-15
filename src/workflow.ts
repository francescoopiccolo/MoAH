import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { stateDir } from "./config.js";

/** Records elapsed machine work. It never infers a person's time spent choosing or configuring. */
export async function measurePreparation<T>(cwd: string, operation: string, action: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const startedAt = new Date().toISOString();
  let completed = false;
  try { const result = await action(); completed = true; return result; }
  finally {
    const record = { startedAt, finishedAt: new Date().toISOString(), operation, completed,
      elapsedMs: performance.now() - start, humanActiveMs: null, scope: "command wall time; not total workflow time" };
    // A measurement failure must not turn a completed installation into a reported installation failure.
    try { await mkdir(stateDir(cwd), { recursive: true }); await appendFile(join(stateDir(cwd), "workflow-events.jsonl"), JSON.stringify(record) + "\n"); }
    catch { console.warn("MoAH could not persist preparation timing."); }
  }
}
