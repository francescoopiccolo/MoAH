import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildCatalog, readCatalog, sourceFingerprint } from "../src/catalog.js";
import { PackageCache } from "../src/streaming/package-cache.js";
import type { Config, IndexedPackage, PackageSpec, ToolMetadata } from "../src/types.js";

const MB = 1024 ** 2;

function streamingConfig(packages: PackageSpec[], overrides: Partial<Config["streaming"]> = {}): Config {
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
      residentBudgetMb: 128,
      idleTtlMs: 120000,
      loadTimeoutMs: 20000,
      callTimeoutMs: 20000,
      estimatedRssMb: 32,
      ...overrides,
    },
    packages,
  };
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "moah-stream-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const toolsFixture = resolve("test/fixtures/tools.mjs");
const unsupportedFixture = resolve("test/fixtures/unsupported.mjs");

function toolSpec(id: string, entry: string): PackageSpec {
  return { id, entry, mode: "stream", stateless: true, workerSdk: "lazy" };
}

test("streamable fixture is indexed without becoming resident", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const config = streamingConfig([toolSpec("tools", toolsFixture)]);
    const catalog = await buildCatalog(config, dir);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].mode, "stream");
    assert.deepEqual(catalog[0].tools.map(tool => tool.name), ["search_remote", "inspect_db"]);
    assert.ok(catalog[0].sourceFingerprint);

    const cache = new PackageCache(catalog, dir, config.streaming, () => {});
    try {
      assert.equal(cache.snapshot().entries.length, 0);
    } finally {
      await cache.close();
    }
  });
});

test("concurrent demands produce one physical load and one resident worker", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const config = streamingConfig([toolSpec("tools", toolsFixture)]);
    const catalog = await buildCatalog(config, dir);
    const events: string[] = [];
    const cache = new PackageCache(catalog, dir, config.streaming, event => events.push(event));
    try {
      assert.equal(cache.snapshot().entries.length, 0);
      const [first, second] = await Promise.all([
        cache.execute("search_remote", "tools", {}, "one"),
        cache.execute("inspect_db", "tools", {}, "two"),
      ]);
      assert.equal(events.filter(event => event === "stream_load_complete").length, 1);
      assert.equal((first as any).details.pid, (second as any).details.pid);
      assert.equal(cache.snapshot().entries.length, 1);
    } finally {
      await cache.close();
    }
  });
});

test("failed worker initialization never publishes a resident entry", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    await mkdir(join(dir, "bad"), { recursive: true });
    const entry = join(dir, "bad", "index.mjs");
    await writeFile(entry, [
      "export default async function (pi) {",
      "  pi.registerTool({",
      "    name: 'bad_tool', label: 'Bad', description: 'Fails after registering',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'bad' }] }; },",
      "  });",
      "  throw new Error('boom after register');",
      "}",
    ].join("\n"), "utf8");

    const root = dirname(entry);
    const tools: ToolMetadata[] = [{
      name: "bad_tool",
      label: "Bad",
      description: "Fails after registering",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }];
    const pkg: IndexedPackage = {
      id: "bad",
      entry,
      root,
      nativeSource: entry,
      mode: "stream",
      provenance: "community-installed",
      autoAcquire: false,
      nativeResident: false,
      routerEligible: true,
      tools,
      workerSdk: "lazy",
      sourceFingerprint: await sourceFingerprint(root),
      reason: "test fixture",
    };

    const config = streamingConfig([]);
    const cache = new PackageCache([pkg], dir, config.streaming, () => {});
    try {
      await assert.rejects(cache.execute("bad_tool", "bad", {}, "call"), /boom after register/);
      assert.equal(cache.snapshot().entries.length, 0);
      assert.equal(cache.snapshot().loading.length, 0);
    } finally {
      await cache.close();
    }
  });
});

test("unsupported extension APIs preserve the native Pi lifecycle", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const config = streamingConfig([toolSpec("unsupported", unsupportedFixture)]);
    const catalog = await buildCatalog(config, dir);
    assert.equal(catalog[0].mode, "native");
    assert.deepEqual(catalog[0].tools, []);
  });
});

test("lazy Pi SDK facade supports defineTool without a full SDK import", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const pkgDir = join(dir, "lazy");
    await mkdir(pkgDir, { recursive: true });
    const entry = join(pkgDir, "index.mjs");
    await writeFile(entry, [
      "import { defineTool } from '@earendil-works/pi-coding-agent';",
      "export default function (pi) {",
      "  pi.registerTool(defineTool({",
      "    name: 'lazy_defined', label: 'Lazy defined', description: 'Uses defineTool',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'lazy-ok' }] }; },",
      "  }));",
      "}",
    ].join("\n"), "utf8");
    const config = streamingConfig([toolSpec("lazy", entry)]);
    const catalog = await buildCatalog(config, dir);
    assert.equal(catalog[0].mode, "stream");
    assert.deepEqual(catalog[0].tools.map(tool => tool.name), ["lazy_defined"]);
    const cache = new PackageCache(catalog, dir, config.streaming, () => {});
    try {
      const result = await cache.execute("lazy_defined", "lazy", {}, "call");
      assert.equal((result as any).content[0].text, "lazy-ok");
    } finally {
      await cache.close();
    }
  });
});

test("source changes invalidate a streamed catalog before runtime use", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const pkgDir = join(dir, "pkg");
    await mkdir(pkgDir, { recursive: true });
    const entry = join(pkgDir, "tools.mjs");
    await copyFile(toolsFixture, entry);
    const config = streamingConfig([toolSpec("tools", entry)]);
    await buildCatalog(config, dir);
    await writeFile(entry, "export default () => {};\n", "utf8");
    await assert.rejects(readCatalog(config, dir), /changed/);
  });
});

test("prefetch cannot evict a current selected package; demand can evict speculation", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const aDir = join(dir, "a");
    const bDir = join(dir, "b");
    await mkdir(aDir, { recursive: true });
    await mkdir(bDir, { recursive: true });

    const aEntry = join(aDir, "index.mjs");
    const bEntry = join(bDir, "index.mjs");
    await writeFile(aEntry, [
      "export default function (pi) {",
      "  pi.registerTool({ name: 'tool_a', label: 'A', description: 'Tool A',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'a' }], details: { pid: process.pid } }; } });",
      "}",
    ].join("\n"), "utf8");
    await writeFile(bEntry, [
      "export default function (pi) {",
      "  pi.registerTool({ name: 'tool_b', label: 'B', description: 'Tool B',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'b' }], details: { pid: process.pid } }; } });",
      "}",
    ].join("\n"), "utf8");

    const config = streamingConfig(
      [toolSpec("a", aEntry), toolSpec("b", bEntry)],
      { maxProcesses: 1, residentBudgetMb: 128 },
    );
    const catalog = await buildCatalog(config, dir);
    const cache = new PackageCache(catalog, dir, config.streaming, () => {});
    try {
      await cache.execute("tool_a", "a", {}, "one");
      cache.beginTurn(["a"]);
      await cache.prefetch(["b"], "speculative");
      assert.ok(cache.snapshot().entries.some(entry => entry.packageId === "a"));
      assert.equal(cache.snapshot().entries.some(entry => entry.packageId === "b"), false);

      await cache.prefetch(["b"], "speculative-fill");
      await cache.execute("tool_a", "a", {}, "two");
      assert.equal(cache.snapshot().entries.some(entry => entry.packageId === "b"), false);
    } finally {
      await cache.close();
    }
  });
});

test("budget reduction evicts idle resident workers", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const config = streamingConfig([toolSpec("tools", toolsFixture)], {
      maxProcesses: 2,
      residentBudgetMb: 128,
      idleTtlMs: 120000,
    });
    const catalog = await buildCatalog(config, dir);
    const cache = new PackageCache(catalog, dir, config.streaming, () => {});
    try {
      await cache.execute("search_remote", "tools", {}, "one");
      assert.equal(cache.snapshot().entries.length, 1);
      const pid = cache.snapshot().entries[0].pid!;
      await cache.setResidentBudgetMb(1);
      assert.equal(cache.snapshot().entries.length, 0);
      assert.throws(() => process.kill(pid, 0));
    } finally {
      await cache.close();
    }
  });
});

test("cold mode disables speculative warm but keeps demand loading", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const config = streamingConfig([toolSpec("tools", toolsFixture)], {
      cold: true,
      hotPreload: 1,
    });
    const catalog = await buildCatalog(config, dir);
    const cache = new PackageCache(catalog, dir, config.streaming, () => {});
    try {
      await cache.preloadHot(1);
      await cache.prefetch(["tools"], "router-auto");
      assert.equal(cache.snapshot().entries.length, 0);
      const result = await cache.execute("inspect_db", "tools", {}, "one");
      assert.equal((result as any).content[0].text, "db-ok");
      assert.equal(cache.snapshot().entries.length, 1);
    } finally {
      await cache.close();
    }
  });
});

test("router-triggered prefetch overlaps demand and reuses the in-flight load", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    await mkdir(dir, { recursive: true });
    const entry = join(dir, "slow.mjs");
    await writeFile(entry, [
      "export default async function (pi) {",
      "  await new Promise(resolve => setTimeout(resolve, 1200));",
      "  pi.registerTool({",
      "    name: 'slow_tool', label: 'Slow', description: 'Slow loading tool',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute() { return { content: [{ type: 'text', text: 'slow-ok' }] }; },",
      "  });",
      "}",
    ].join("\n"), "utf8");

    const config = streamingConfig([toolSpec("slow", entry)]);
    const catalog = await buildCatalog(config, dir);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const cache = new PackageCache(catalog, dir, config.streaming, (event, details) => events.push({ event, details }));
    try {
      const prefetch = cache.prefetch(["slow"], "router-auto");
      await delay(600);
      const result = await cache.execute("slow_tool", "slow", {}, "call");
      await prefetch;
      assert.equal((result as any).content[0].text, "slow-ok");
      assert.equal(events.filter(event => event.event === "stream_load_complete").length, 1);
      const loadElapsedMs = events.find(event => event.event === "stream_load_complete")!.details.elapsedMs as number;
      const waitMs = events.find(event => event.event === "stream_execution_wait")!.details.waitMs as number;
      assert.ok(
        waitMs < loadElapsedMs * 0.8,
        `expected meaningful overlap: wait=${waitMs}ms load=${loadElapsedMs}ms`,
      );
    } finally {
      await cache.close();
    }
  });
});

test("cache hits survive unreadable source until eviction", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const pkgDir = join(dir, "pkg");
    await mkdir(pkgDir, { recursive: true });
    const entry = join(pkgDir, "tools.mjs");
    await copyFile(toolsFixture, entry);
    const config = streamingConfig([toolSpec("tools", entry)], { maxProcesses: 1, residentBudgetMb: 128 });
    const catalog = await buildCatalog(config, dir);
    const cache = new PackageCache(catalog, dir, config.streaming, () => {});
    try {
      const first = await cache.execute("search_remote", "tools", {}, "one");
      assert.equal((first as any).content[0].text, "remote-ok");
      await writeFile(entry, "export default () => {};\n", "utf8");
      const second = await cache.execute("inspect_db", "tools", {}, "two");
      assert.equal((second as any).content[0].text, "db-ok");
      await cache.setResidentBudgetMb(1);
      await assert.rejects(cache.execute("search_remote", "tools", {}, "three"), /changed since indexing/);
    } finally {
      await cache.close();
    }
  });
});

test("deselection keeps a worker warm; TTL eviction and reselection cause a new load", { timeout: 60000 }, async () => {
  await withTemp(async dir => {
    const config = streamingConfig([toolSpec("tools", toolsFixture)], {
      idleTtlMs: 80,
      maxProcesses: 2,
      residentBudgetMb: 128,
    });
    const catalog = await buildCatalog(config, dir);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const cache = new PackageCache(catalog, dir, config.streaming, (event, details) => events.push({ event, details }));
    try {
      await cache.execute("search_remote", "tools", {}, "one");
      const firstPid = cache.snapshot().entries[0].pid;

      cache.beginTurn([]);
      assert.equal(cache.snapshot().entries.length, 1);
      assert.equal(cache.snapshot().entries[0].state, "RESIDENT_IDLE");

      cache.beginTurn(["tools"]);
      await cache.execute("inspect_db", "tools", {}, "two");
      assert.equal(cache.snapshot().entries[0].pid, firstPid);
      assert.equal(events.filter(event => event.event === "stream_load_complete").length, 1);

      cache.beginTurn([]);
      await delay(350);
      assert.equal(cache.snapshot().entries.length, 0);

      await cache.execute("search_remote", "tools", {}, "three");
      assert.equal(events.filter(event => event.event === "stream_load_complete").length, 2);
      assert.notEqual(cache.snapshot().entries[0].pid, firstPid);
    } finally {
      await cache.close();
    }
  });
});
