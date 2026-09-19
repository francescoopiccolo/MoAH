import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repo = resolve(".");
const cli = join(repo, "src/cli.ts");
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;

function config() {
  return {
    baseline: { enabled: false },
    router: {
      enabled: true,
      mode: "auto",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      apiKeyEnv: "MOAH_ROUTER_API_KEY",
      maxTools: 6,
      baseTools: ["read"],
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
    packages: [
      {
        id: "stream-probe",
        entry: "pkg/index.mjs",
        mode: "stream",
        stateless: true,
        workerSdk: "lazy",
      },
    ],
  };
}

const packageSource = [
  "export default function (pi) {",
  "  pi.registerTool({",
  '    name: "stream_probe",',
  '    label: "Stream Probe",',
  '    description: "Echo a short phrase exactly, using an isolated worker.",',
  '    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },',
  "    async execute(id, args, signal, onUpdate, ctx) {",
  "      return { content: [{ type: \"text\", text: `stream_probe:${args.text}:${process.pid}` }], details: { pid: process.pid, cwd: ctx.cwd } };",
  "    },",
  "  });",
  "}",
].join("\n");

async function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveResult({ stdout, stderr, code }));
  });
}

async function setupTrial(dir: string): Promise<void> {
  const pkgDir = join(dir, "pkg");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(join(dir, "moah.config.json"), JSON.stringify(config(), null, 2), "utf8");
  await writeFile(join(pkgDir, "index.mjs"), packageSource, "utf8");
}

async function traceEvents(dir: string): Promise<any[]> {
  const traceDir = join(dir, ".moah", "traces");
  const files = await readdir(traceDir).catch(() => [] as string[]);
  const events: any[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(traceDir, file), "utf8")).split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* ignore malformed trace line */ }
    }
  }
  return events;
}

async function trial(prompt: string): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), "moah-real-overlap-"));
  try {
    await setupTrial(dir);
    const indexed = await run(process.execPath, ["--import", tsxLoader, cli, "index"], dir);
    if (indexed.code !== 0) throw new Error(`index failed: ${indexed.stderr}`);

    const startedAt = Date.now();
    const pi = await run(process.execPath, [
      "--import", tsxLoader, cli, "pi",
      "--provider", "openrouter",
      "--model", "openai/gpt-4o-mini",
      "--mode", "json",
      "-p", prompt,
    ], dir);

    const events = await traceEvents(dir);
    const toolExecutions = (pi.stdout.match(/"type":"tool_execution_end"/g) ?? []).length;
    const loadComplete = events.find(event => event.event === "stream_load_complete");
    const loadStarted = events.find(event => event.event === "stream_load_started");
    const prefetchStarted = events.find(event => event.event === "stream_prefetch_started");
    const routerEvent = events.find(event => event.event === "router");
    const waits = events
      .filter(event => event.event === "stream_execution_wait")
      .map(event => Number(event.waitMs ?? 0));
    const cacheHits = events.filter(event => event.event === "stream_cache_hit").length;
    const loadMs = Number(loadComplete?.elapsedMs ?? 0);

    return {
      toolExecutions,
      exitCode: pi.code,
      routerElapsedMs: Number(routerEvent?.elapsedMs ?? 0),
      prefetchToLoadStartMs: loadStarted && prefetchStarted
        ? Math.max(0, new Date(loadStarted.time).getTime() - new Date(prefetchStarted.time).getTime())
        : null,
      loadElapsedMs: loadMs,
      waits,
      cacheHits,
      hiddenMs: Math.max(0, loadMs - (waits[0] ?? loadMs)),
      hiddenFraction: loadMs > 0 ? Math.max(0, loadMs - (waits[0] ?? loadMs)) / loadMs : null,
      stderrTail: pi.stderr.trim().split(/\r?\n/).slice(-3).join("\n"),
      totalRunMs: Date.now() - startedAt,
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const results: Record<string, unknown>[] = [];
  for (let i = 1; i <= 3; i++) {
    results.push(await trial(`Call stream_probe with text cold_${i}, then write the exact result as your final answer.`));
  }
  for (let i = 1; i <= 3; i++) {
    results.push(await trial(`Call stream_probe with text warm_${i}a, then call stream_probe with text warm_${i}b, then write both exact results as your final answer.`));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
