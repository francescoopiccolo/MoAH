import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Trace } from "./types.js";

export function createTrace(directory: string): Trace {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `trace-${Date.now()}-${randomUUID()}.jsonl`);
  let warned = false;
  // Callers log metadata only: never prompts, tool arguments, outputs or credentials.
  return (event, details) => {
    try { appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), event, ...details }) + "\n"); }
    catch { if (!warned) { process.stderr.write("MoAH: telemetry unavailable\n"); warned = true; } }
  };
}
