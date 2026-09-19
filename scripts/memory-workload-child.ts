import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildCatalog } from "../src/catalog.js";
import { PackageCache } from "../src/streaming/package-cache.js";
import type { Config, PackageSpec } from "../src/types.js";

const [markerFile, mode, durationText, workerCountText] = process.argv.slice(2);
const durationMs = Number(durationText ?? 8000);
const workerCount = Number(workerCountText ?? 5);

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
      maxProcesses: workerCount,
      residentBudgetMb: 1024,
      idleTtlMs: 120000,
      loadTimeoutMs: 30000,
      callTimeoutMs: 30000,
      estimatedRssMb: 64,
    },
    packages,
  };
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "moah-memory-workload-"));
  const specs: PackageSpec[] = [];

  for (let i = 0; i < workerCount; i++) {
    const pkgDir = join(dir, `pkg-${i}`);
    await mkdir(pkgDir, { recursive: true });
    const entry = join(pkgDir, "index.mjs");
    await writeFile(entry, [
      `const payload = Buffer.alloc(8 * 1024 * 1024, ${i});`,
      "export default function (pi) {",
      `  pi.registerTool({ name: 'tool_${i}', label: 'Tool ${i}', description: 'Synthetic package ${i}',`,
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: payload[0].toString() }] }; },",
      "  });",
      "}",
    ].join("\n"), "utf8");
    specs.push({ id: `pkg-${i}`, entry, mode: "stream", stateless: true, workerSdk: "lazy" });
  }

  const config = configFor(specs);
  const catalog = await buildCatalog(config, dir);
  const cache = new PackageCache(catalog, dir, config.streaming, () => {});

  if (mode === "workers" || mode === "evicted") {
    await cache.prefetch(specs.map(spec => spec.id), "validation");
  }

  if (mode === "evicted") {
    await cache.setResidentBudgetMb(1);
  }

  if (markerFile) await writeFile(markerFile, JSON.stringify({ mode, pid: process.pid, snapshot: cache.snapshot() }), "utf8");

  await delay(durationMs);
  await cache.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
