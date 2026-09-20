import { resolve } from "node:path";
import { PackageWorkerClient } from "../src/streaming/package-worker-client.js";

process.env.MOAH_WORKER_STAGE_TRACE = "1";

const corpus = resolve("data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions");
const examples = resolve("node_modules/@earendil-works/pi-coding-agent/examples/extensions");

const packages = [
  { name: "hello", source: resolve(examples, "hello.ts"), artifact: resolve("stream-artifacts/hello.bundle.mjs") },
  { name: "structured-output", source: resolve(corpus, "structured-output.ts"), artifact: resolve("stream-artifacts/structured-output.bundle.mjs") },
  { name: "rg", source: resolve(corpus, "truncated-tool.ts"), artifact: resolve("stream-artifacts/rg.bundle.mjs") },
];

function duration(stages: Array<{ stage: string; ts: number; rss?: number }>, from: string, to: string): number | null {
  const a = stages.find(s => s.stage === from);
  const b = stages.find(s => s.stage === to);
  if (!a || !b) return null;
  return b.ts - a.ts;
}

async function once(entry?: string, lazySdk = true) {
  const worker = new PackageWorkerClient(process.cwd());
  try {
    if (entry) {
      await worker.request("load", { entry, lazySdk }, 60000);
    } else {
      await worker.request("memory", {}, 60000);
    }
    const stages = worker.stages;
    return {
      stages,
      parentBeforeSpawn: stages.find(s => s.stage === "parent_before_spawn")?.ts,
      parentAfterSpawn: stages.find(s => s.stage === "parent_after_spawn")?.ts,
      workerEntry: stages.find(s => s.stage === "worker_entry")?.ts,
      shimsInitialized: stages.find(s => s.stage === "shims_initialized")?.ts,
      loaderInitializing: stages.find(s => s.stage === "loader_initializing")?.ts,
      loaderInitialized: stages.find(s => s.stage === "loader_initialized")?.ts,
      artifactImportStart: stages.find(s => s.stage === "artifact_import_start")?.ts,
      artifactImportComplete: stages.find(s => s.stage === "artifact_import_complete")?.ts,
      toolRegistrationComplete: stages.find(s => s.stage === "tool_registration_complete")?.ts,
      readySend: stages.find(s => s.stage === "ready_send")?.ts,
      readySent: stages.find(s => s.stage === "ready_sent")?.ts,
      finalRss: stages.at(-1)?.rss ?? worker.rss,
      durations: {
        spawn: duration(stages, "parent_before_spawn", "parent_after_spawn"),
        nodeBootstrap: duration(stages, "parent_after_spawn", "worker_entry"),
        workerInit: duration(stages, "worker_entry", "shims_initialized"),
        loaderInit: duration(stages, "loader_initializing", "loader_initialized"),
        artifactImport: duration(stages, "artifact_import_start", "artifact_import_complete"),
        toolRegistration: duration(stages, "artifact_import_complete", "tool_registration_complete"),
        readyIpc: duration(stages, "ready_send", "ready_sent"),
        total: duration(stages, "parent_before_spawn", "ready_sent") ?? duration(stages, "parent_before_spawn", "worker_entry"),
      },
    };
  } finally {
    await worker.close();
  }
}

function summarize(values: number[]) {
  const arr = values.filter(v => v !== null) as number[];
  if (!arr.length) return null;
  arr.sort((a, b) => a - b);
  return {
    min: arr[0],
    median: arr[Math.floor(arr.length / 2)],
    max: arr.at(-1)!,
  };
}

async function runSeries(entry?: string) {
  const rows: any[] = [];
  for (let i = 0; i < 5; i++) rows.push(await once(entry));
  const keys = ["spawn", "nodeBootstrap", "workerInit", "loaderInit", "artifactImport", "toolRegistration", "readyIpc", "total"];
  const durations: Record<string, unknown> = {};
  for (const key of keys) {
    durations[key] = summarize(rows.map(r => r.durations[key]));
  }
  return {
    durations,
    finalRss: summarize(rows.map(r => r.finalRss)),
    stages: rows[0].stages,
  };
}

async function main() {
  const output: any = {};
  output.empty = await runSeries();
  for (const pkg of packages) {
    output[pkg.name] = {
      source: await runSeries(pkg.source),
      artifact: await runSeries(pkg.artifact),
    };
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
