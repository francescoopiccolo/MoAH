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
const corpus = resolve("data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions");
const examples = resolve("node_modules/@earendil-works/pi-coding-agent/examples/extensions");

const candidates = [
  {
    id: "hello",
    source: join(examples, "hello.ts"),
    tool: "hello",
    prompt: "Call hello with name MoAH, then write the exact greeting as your final answer.",
  },
  {
    id: "structured-output",
    source: join(corpus, "structured-output.ts"),
    tool: "structured_output",
    prompt: "Use structured_output with headline 'Summary', summary 'All good', actionItems ['done'].",
  },
  {
    id: "truncated-tool",
    source: join(corpus, "truncated-tool.ts"),
    tool: "rg",
    prompt: "Use rg to search for 'MoAH' in the current directory, then write the result as your final answer.",
  },
];

function config(packageId: string) {
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
        id: packageId,
        entry: "pkg/index.ts",
        mode: "stream",
        stateless: true,
        workerSdk: "lazy",
      },
    ],
  };
}

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

async function main() {
  const results: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const dir = await mkdtemp(join(tmpdir(), "moah-official-e2e-"));
    try {
      const pkgDir = join(dir, "pkg");
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(dir, "moah.config.json"), JSON.stringify(config(candidate.id), null, 2), "utf8");
      await copyFile(candidate.source, join(pkgDir, "index.ts"));

      const indexed = await run(process.execPath, ["--import", tsxLoader, cli, "index"], dir);
      if (indexed.code !== 0) throw new Error(`index failed for ${candidate.id}: ${indexed.stderr}`);

      const catalog = JSON.parse(await readFile(join(dir, ".moah", "catalog.json"), "utf8"));
      const pi = await run(process.execPath, [
        "--import", tsxLoader, cli, "pi",
        "--provider", "openrouter",
        "--model", "openai/gpt-4o-mini",
        "--mode", "json",
        "-p", candidate.prompt,
      ], dir);

      const events = await traceEvents(dir);
      const load = events.find(event => event.event === "stream_load_complete");
      const waits = events.filter(event => event.event === "stream_execution_wait").map(event => Number(event.waitMs ?? 0));
      const loadMs = Number(load?.elapsedMs ?? 0);
      const toolExecutionCount = (pi.stdout.match(/"type":"tool_execution_end"/g) ?? []).length;
      const routerEvent = events.find(event => event.event === "router");
      const resultText = pi.stdout.match(/"text":"([^"]*)"/g)?.slice(-3).join(" | ");
      const hasTerminate = pi.stdout.includes('"terminate":true');

      results.push({
        package: candidate.id,
        tool: candidate.tool,
        streamingClass: catalog.packages[0]?.streamingClass ?? null,
        catalogMode: catalog.packages[0]?.mode ?? null,
        routerSelected: routerEvent?.selected ?? [],
        toolExecutions: toolExecutionCount,
        loadElapsedMs: loadMs,
        waits,
        hiddenMs: loadMs > 0 ? Math.max(0, loadMs - (waits[0] ?? loadMs)) : 0,
        hiddenFraction: loadMs > 0 ? Math.max(0, loadMs - (waits[0] ?? loadMs)) / loadMs : null,
        hasTerminateSemantic: hasTerminate,
        exitCode: pi.code,
        resultText,
        stderrTail: pi.stderr.trim().split(/\r?\n/).slice(-2).join("\n"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
