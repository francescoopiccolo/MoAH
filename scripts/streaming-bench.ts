import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { buildCatalog } from "../src/catalog.js";
import { PackageCache } from "../src/streaming/package-cache.js";
import type { Config, PackageSpec } from "../src/types.js";

const toolsFixture = resolve("test/fixtures/tools.mjs");

function configFor(packages: PackageSpec[]): Config {
  return {
    baseline: { enabled: false },
    router: {
      enabled: true,
      mode: "auto",
      baseUrl: "https://router.example/v1",
      model: "router-mini",
      apiKeyEnv: "TEST_ROUTER_KEY",
      maxTools: 6,
      baseTools: [],
    },
    streaming: {
      enabled: true,
      prefetch: true,
      cold: false,
      hotPreload: 0,
      maxProcesses: 2,
      residentBudgetMb: 512,
      idleTtlMs: 120000,
      loadTimeoutMs: 30000,
      callTimeoutMs: 30000,
      estimatedRssMb: 64,
    },
    packages,
  };
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "moah-stream-bench-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  await withTemp(async dir => {
    const config = configFor([{ id: "tools", entry: toolsFixture, mode: "stream", stateless: true, workerSdk: "lazy" }]);
    const catalog = await buildCatalog(config, dir);
    const cache = new PackageCache(catalog, dir, config.streaming, () => {});

    try {
      const coldStart = performance.now();
      await cache.execute("search_remote", "tools", {}, "cold");
      const coldMs = performance.now() - coldStart;
      const coldSnapshot = cache.snapshot().entries[0];

      const warmStart = performance.now();
      await cache.execute("inspect_db", "tools", {}, "warm");
      const warmMs = performance.now() - warmStart;
      const warmSnapshot = cache.snapshot().entries[0];

      console.log(JSON.stringify({
        fixture: "tools.mjs (two tools, allocates 16 MiB)",
        coldLoadMs: Math.round(coldMs),
        warmHitMs: Math.round(warmMs),
        workerRssBytes: warmSnapshot.rss,
        workerRssMiB: Number((warmSnapshot.rss / 1024 ** 2).toFixed(1)),
        residentEntries: cache.snapshot().entries.length,
      }, null, 2));
    } finally {
      await cache.close();
    }
  });

  await withTemp(async dir => {
    const pkgDir = join(dir, "slow");
    await mkdir(pkgDir, { recursive: true });
    const entry = join(pkgDir, "index.mjs");
    await writeFile(entry, [
      "export default async function (pi) {",
      "  await new Promise(resolve => setTimeout(resolve, 800));",
      "  pi.registerTool({",
      "    name: 'slow_tool', label: 'Slow', description: 'Slow loading tool',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'slow-ok' }] }; },",
      "  });",
      "}",
    ].join("\n"), "utf8");

    const config = configFor([{ id: "slow", entry, mode: "stream", stateless: true, workerSdk: "lazy" }]);
    const catalog = await buildCatalog(config, dir);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const cache = new PackageCache(catalog, dir, config.streaming, (event, details) => events.push({ event, details }));

    try {
      const prefetch = cache.prefetch(["slow"], "router-auto");
      await delay(400);
      const start = performance.now();
      await cache.execute("slow_tool", "slow", {}, "call");
      const demandWaitMs = performance.now() - start;
      await prefetch;

      const load = events.find(event => event.event === "stream_load_complete");
      const wait = events.find(event => event.event === "stream_execution_wait");
      console.log(JSON.stringify({
        fixture: "slow.mjs (800 ms package load)",
        loadElapsedMs: Math.round(Number(load?.details.elapsedMs ?? 0)),
        foregroundWaitMs: Math.round(Number(wait?.details.waitMs ?? demandWaitMs)),
        hiddenMs: Math.round(Number(load?.details.elapsedMs ?? 0) - Number(wait?.details.waitMs ?? demandWaitMs)),
        physicalLoads: events.filter(event => event.event === "stream_load_complete").length,
      }, null, 2));
    } finally {
      await cache.close();
    }
  });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
