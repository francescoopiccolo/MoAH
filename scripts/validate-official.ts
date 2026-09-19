import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCatalog } from "../src/catalog.js";
import { PackageWorkerClient } from "../src/streaming/package-worker-client.js";
import type { Config, PackageSpec } from "../src/types.js";

const corpus = resolve(
  "data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions",
);
const examples = resolve("node_modules/@earendil-works/pi-coding-agent/examples/extensions");

const candidates: Array<{ id: string; entry: string }> = [
  { id: "hello", entry: join(examples, "hello.ts") },
  { id: "structured-output", entry: join(corpus, "structured-output.ts") },
  { id: "truncated-tool", entry: join(corpus, "truncated-tool.ts") },
  { id: "question", entry: join(corpus, "question.ts") },
];

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
  const dir = await mkdtemp(join(tmpdir(), "moah-validate-official-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    await withTemp(async dir => {
      const config = configFor([
        {
          id: candidate.id,
          entry: candidate.entry,
          mode: "stream",
          stateless: true,
          workerSdk: "lazy",
        },
      ]);
      const catalog = await buildCatalog(config, dir);
      results.push({
        id: candidate.id,
        mode: catalog[0].mode,
        streamingClass: catalog[0].streamingClass ?? null,
        tools: catalog[0].tools.map(tool => tool.name),
        reason: catalog[0].reason,
      });
    });
  }

  console.log(JSON.stringify({ officialCandidateProbes: results }, null, 2));

  const empty = new PackageWorkerClient(process.cwd());
  const emptyRss = await empty.request("memory", {}, 20000);
  await empty.close();

  await withTemp(async dir => {
    const lazyDir = join(dir, "lazy");
    await mkdir(lazyDir, { recursive: true });
    const lazyEntry = join(lazyDir, "index.mjs");
    await writeFile(lazyEntry, [
      "import { defineTool } from '@earendil-works/pi-coding-agent';",
      "export default function (pi) {",
      "  pi.registerTool(defineTool({",
      "    name: 'lazy_probe', label: 'Lazy probe', description: 'Lazy SDK probe',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },",
      "  }));",
      "}",
    ].join("\n"), "utf8");
    const lazyWorker = new PackageWorkerClient(dir);
    const lazy = await lazyWorker.request("load", { entry: lazyEntry, lazySdk: true }, 20000);
    await lazyWorker.close();

    const plainWorker = new PackageWorkerClient(dir);
    const plain = await plainWorker.request("load", { entry: resolve("test/fixtures/tools.mjs"), lazySdk: false }, 20000);
    await plainWorker.close();

    console.log(JSON.stringify({
      workerRssBytes: {
        empty: (emptyRss as any).rss,
        emptyMiB: Number(((emptyRss as any).rss / 1024 ** 2).toFixed(1)),
        lazySdkBootstrap: (lazy as any).rss,
        lazySdkBootstrapMiB: Number(((lazy as any).rss / 1024 ** 2).toFixed(1)),
        plainTwoToolFixture: (plain as any).rss,
        plainTwoToolFixtureMiB: Number(((plain as any).rss / 1024 ** 2).toFixed(1)),
        lazySdkDeltaMiB: Number((((lazy as any).rss - (emptyRss as any).rss) / 1024 ** 2).toFixed(1)),
        plainFixtureDeltaMiB: Number((((plain as any).rss - (emptyRss as any).rss) / 1024 ** 2).toFixed(1)),
      },
    }, null, 2));
  });

  const officialWorkerRss: Record<string, unknown> = {};
  for (const candidate of candidates.slice(0, 3)) {
    const worker = new PackageWorkerClient(process.cwd());
    try {
      const loaded = await worker.request("load", { entry: candidate.entry, lazySdk: true }, 20000);
      officialWorkerRss[candidate.id] = {
        rssBytes: (loaded as any).rss,
        rssMiB: Number(((loaded as any).rss / 1024 ** 2).toFixed(1)),
        deltaOverEmptyMiB: Number((((loaded as any).rss - (emptyRss as any).rss) / 1024 ** 2).toFixed(1)),
      };
    } finally {
      await worker.close();
    }
  }
  console.log(JSON.stringify({ officialWorkerRss }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
