import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repo = resolve(".");
const cli = join(repo, "src/cli.ts");
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
const helloSource = resolve("node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts");
const prompt = "Call hello with name MoAH, then write the exact greeting as your final answer.";

type Mode = "A" | "B" | "C" | "D";

function config(mode: Mode) {
  const stream = mode === "C" || mode === "D";
  return {
    baseline: { enabled: false },
    router: {
      enabled: mode !== "A",
      mode: "auto" as const,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      apiKeyEnv: "MOAH_ROUTER_API_KEY",
      maxTools: 6,
      baseTools: ["read"],
    },
    streaming: {
      enabled: stream,
      prefetch: mode === "D",
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
      stream
        ? { id: "hello", entry: "pkg/hello.ts", mode: "stream", stateless: true, workerSdk: "lazy" }
        : { id: "hello", entry: "pkg/hello.ts", mode: "native", nativeResident: true },
    ],
  };
}

async function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null; elapsedMs: number }> {
  return new Promise((resolveResult, reject) => {
    const start = Date.now();
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
    child.on("close", code => resolveResult({ stdout, stderr, code, elapsedMs: Date.now() - start }));
  });
}

async function traceEvents(dir: string): Promise<any[]> {
  const traceDir = join(dir, ".moah", "traces");
  const files = await readdir(traceDir).catch(() => [] as string[]);
  const events: any[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(traceDir, file), "utf8")).split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* ignore */ }
    }
  }
  return events;
}

async function trial(mode: Mode): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), "moah-full-bench-"));
  try {
    const pkgDir = join(dir, "pkg");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(dir, "moah.config.json"), JSON.stringify(config(mode), null, 2), "utf8");
    await copyFile(helloSource, join(pkgDir, "hello.ts"));

    const indexed = await run(process.execPath, ["--import", tsxLoader, cli, "index"], dir);
    if (indexed.code !== 0) throw new Error(`index failed for ${mode}: ${indexed.stderr}`);

    const command = mode === "A" ? "dense" : "pi";
    const pi = await run(process.execPath, [
      "--import", tsxLoader, cli, command,
      "--provider", "openrouter",
      "--model", "openai/gpt-4o-mini",
      "--mode", "json",
      "-p", prompt,
    ], dir);

    const events = mode === "A" ? [] : await traceEvents(dir);
    const routerEvent = events.find(event => event.event === "router");
    const load = events.find(event => event.event === "stream_load_complete");
    const waits = events.filter(event => event.event === "stream_execution_wait").map(event => Number(event.waitMs ?? 0));
    const loadMs = Number(load?.elapsedMs ?? 0);
    const toolExecutions = (pi.stdout.match(/"type":"tool_execution_end"/g) ?? []).length;

    return {
      mode,
      exitCode: pi.code,
      endToEndMs: pi.elapsedMs,
      toolExecutions,
      routerElapsedMs: Number(routerEvent?.elapsedMs ?? 0),
      routerSelected: routerEvent?.selected ?? [],
      packageLoadElapsedMs: loadMs,
      waits,
      hiddenMs: loadMs > 0 ? Math.max(0, loadMs - (waits[0] ?? loadMs)) : 0,
      hiddenFraction: loadMs > 0 ? Math.max(0, loadMs - (waits[0] ?? loadMs)) / loadMs : null,
      cacheHits: events.filter(event => event.event === "stream_cache_hit").length,
      loads: events.filter(event => event.event === "stream_load_complete").length,
      stderrTail: pi.stderr.trim().split(/\r?\n/).slice(-2).join("\n"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const modes: Mode[] = ["A", "B", "C", "D"];
  const rows: Record<string, unknown>[] = [];
  for (const mode of modes) {
    for (let i = 1; i <= 3; i++) rows.push(await trial(mode));
  }
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
