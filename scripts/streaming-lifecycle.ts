import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatalog } from "../src/catalog.js";
import { readConfig } from "../src/config.js";
import { PackageCache } from "../src/streaming/package-cache.js";
import type { IndexedPackage } from "../src/types.js";

const dir = await mkdtemp(join(tmpdir(), "moah-streaming-lifecycle-"));
try {
  const config = await readConfig("benchmarks/streaming-experimental.json");
  const catalog = await buildCatalog(config, process.cwd());
  const streams = catalog.filter(pkg => pkg.mode === "stream") as IndexedPackage[];
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];
  const cache = new PackageCache(streams, process.cwd(), config.streaming, (event, details) => events.push({ event, details }));

  const loadCount = () => events.filter(e => e.event === "stream_load_complete").length;
  const hitCount = () => events.filter(e => e.event === "stream_cache_hit").length;
  const evictCount = () => events.filter(e => e.event === "stream_evict").length;

  const rows: any[] = [];
  const snapshotRow = (label: string) => ({
    label,
    loads: loadCount(),
    hits: hitCount(),
    evictions: evictCount(),
    residents: cache.snapshot().entries.map(e => ({ packageId: e.packageId, pid: e.pid, rss: e.rss, state: e.state })),
  });

  await cache.execute("rg", "rg", { pattern: "MoAH" }, "one");
  rows.push(snapshotRow("rg cold"));
  await cache.execute("rg", "rg", { pattern: "MoAH" }, "two");
  rows.push(snapshotRow("rg warm"));
  await cache.execute("structured_output", "structured-output", { headline: "x", summary: "y", actionItems: [] }, "three");
  rows.push(snapshotRow("structured evicts rg"));
  await cache.execute("rg", "rg", { pattern: "MoAH" }, "four");
  rows.push(snapshotRow("rg reloads"));

  await cache.close();
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
