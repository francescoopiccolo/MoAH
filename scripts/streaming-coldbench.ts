import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { buildCatalog } from "../src/catalog.js";
import { readConfig } from "../src/config.js";
import { PackageCache } from "../src/streaming/package-cache.js";
import type { IndexedPackage } from "../src/types.js";

const config = await readConfig("benchmarks/streaming-experimental.json");
const catalog = await buildCatalog(config, process.cwd());
const streams = catalog.filter(pkg => pkg.mode === "stream") as IndexedPackage[];

const rows: any[] = [];

for (const pkg of streams) {
  const tool = pkg.tools[0];
  const cache = new PackageCache(streams, process.cwd(), config.streaming, () => {});
  try {
    const coldStart = performance.now();
    await cache.execute(tool.name, pkg.id, toolArgs(tool.name), "cold");
    const coldMs = performance.now() - coldStart;
    const pid = cache.snapshot().entries.find(e => e.packageId === pkg.id)?.pid;

    const warmStart = performance.now();
    await cache.execute(tool.name, pkg.id, toolArgs(tool.name), "warm");
    const warmMs = performance.now() - warmStart;

    await cache.close();

    const prefetchCache = new PackageCache(streams, process.cwd(), config.streaming, () => {});
    try {
      const prefetch = prefetchCache.prefetch([pkg.id], "bench");
      await delay(200);
      const demandStart = performance.now();
      await prefetchCache.execute(tool.name, pkg.id, toolArgs(tool.name), "prefetch");
      const demandMs = performance.now() - demandStart;
      await prefetch;
      rows.push({
        package: pkg.id,
        tool: tool.name,
        coldMs: Math.round(coldMs),
        warmMs: Math.round(warmMs),
        demandAfter200msMs: Math.round(demandMs),
        pid,
        workerRss: prefetchCache.snapshot().entries[0]?.rss ?? cache.snapshot().entries[0]?.rss ?? null,
      });
    } finally {
      await prefetchCache.close();
    }
  } finally {
    await cache.close();
  }
}

console.log(JSON.stringify(rows, null, 2));

function toolArgs(name: string): Record<string, unknown> {
  if (name === "hello") return { name: "MoAH" };
  if (name === "structured_output") return { headline: "Summary", summary: "All good", actionItems: [] };
  if (name === "rg") return { pattern: "MoAH" };
  return {};
}
