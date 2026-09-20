import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { PackageWorkerClient } from "../src/streaming/package-worker-client.js";

process.env.MOAH_WORKER_STAGE_TRACE = "1";

const variants = {
  source: resolve("node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts"),
  artifact: resolve("stream-artifacts/hello.bundle.mjs"),
  externalized: resolve("stream-artifacts/hello.externalized.mjs"),
};

async function once(entry: string) {
  const start = performance.now();
  const worker = new PackageWorkerClient(process.cwd());
  try {
    await worker.request("load", { entry, lazySdk: true }, 60000);
    const importStart = worker.stages.find(s => s.stage === "artifact_import_start")?.ts;
    const importComplete = worker.stages.find(s => s.stage === "artifact_import_complete")?.ts;
    return {
      totalMs: performance.now() - start,
      importMs: importStart && importComplete ? importComplete - importStart : null,
      rss: worker.rss,
    };
  } finally {
    await worker.close();
  }
}

async function main() {
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(variants)) {
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await once(entry));
    const vals = (key: "totalMs" | "importMs" | "rss") => rows.map(r => r[key]).filter(v => v !== null).sort((a: any, b: any) => a - b);
    const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
    out[name] = {
      totalMsMedian: median(vals("totalMs")),
      importMsMedian: vals("importMs").length ? median(vals("importMs")) : null,
      rssMedian: median(vals("rss")),
      rows,
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
