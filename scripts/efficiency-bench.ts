import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(".");
const bin = join(repo, "bin", "moah.mjs");
const piCli = join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const helloSource = join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "examples", "extensions", "hello.ts");

const taskName = process.env.TASK ?? "bugfix";
const prompt = taskName === "feature"
  ? "Add the missing sub function to src/calc.js so that `node test.js` passes. Run `node test.js` to verify."
  : "Fix the double function in src/calc.js so that `node test.js` passes. Run `node test.js` to verify your fix.";

type Harness = "A" | "B" | "C" | "D" | "E";

function configFor(mode: Harness) {
  const stream = mode === "C" || mode === "D";
  return {
    baseline: { enabled: true },
    router: {
      enabled: mode !== "A",
      mode: "auto" as const,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      apiKeyEnv: "MOAH_ROUTER_API_KEY",
      maxTools: 6,
      baseTools: ["read", "bash", "powershell", "edit", "write"],
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
        ? { id: "hello", entry: "hello.ts", mode: "stream", stateless: true, workerSdk: "lazy" }
        : { id: "hello", entry: "hello.ts", mode: "native", nativeResident: true },
    ],
  };
}

async function run(cwd: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null; elapsedMs: number }> {
  return new Promise(resolveResult => {
    const start = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32" && command.endsWith(".cmd"),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => resolveResult({ stdout, stderr, code: null, elapsedMs: Date.now() - start }));
    child.on("close", code => resolveResult({ stdout, stderr, code, elapsedMs: Date.now() - start }));
  });
}

function sumMessageUsage(stdout: string) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, processedTotal: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('"type":"message_end"')) continue;
    try {
      const obj = JSON.parse(line);
      const usage = obj?.message?.usage;
      if (!usage) continue;
      totals.input += Number(usage.input ?? 0);
      totals.output += Number(usage.output ?? 0);
      totals.cacheRead += Number(usage.cacheRead ?? 0);
      totals.cacheWrite += Number(usage.cacheWrite ?? 0);
      totals.processedTotal += Number(usage.totalTokens ?? usage.total ?? 0);
    } catch { /* ignore */ }
  }
  return totals;
}

function openCodeUsage(stdout: string) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, processedTotal: 0, calls: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('"type":"step_finish"')) continue;
    try {
      const obj = JSON.parse(line);
      const tokens = obj?.part?.tokens;
      if (!tokens) continue;
      totals.input += Number(tokens.input ?? 0);
      totals.output += Number(tokens.output ?? 0);
      totals.cacheRead += Number(tokens.cache?.read ?? 0);
      totals.cacheWrite += Number(tokens.cache?.write ?? 0);
      totals.processedTotal += Number(tokens.total ?? 0);
      totals.calls += 1;
    } catch { /* ignore */ }
  }
  return totals;
}

async function traceMetrics(dir: string) {
  const traceDir = join(dir, ".moah", "traces");
  const files = await readdir(traceDir).catch(() => [] as string[]);
  let routerTokens = 0;
  let routerCalls = 0;
  let loads = 0;
  let hits = 0;
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(traceDir, file), "utf8")).split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.event === "router") {
          routerTokens += Number(event.usage?.totalTokens ?? 0);
          routerCalls += 1;
        }
        if (event.event === "stream_load_complete") loads += 1;
        if (event.event === "stream_cache_hit") hits += 1;
      } catch { /* ignore */ }
    }
  }
  return { routerTokens, routerCalls, loads, hits };
}

async function trial(mode: Harness): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), "moah-efficiency-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    if (taskName === "feature") {
      await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 2; }\n", "utf8");
      await writeFile(join(dir, "test.js"), [
        "import { double, sub } from './src/calc.js';",
        "if (double(4) !== 8) { console.error('FAIL double', double(4)); process.exit(1); }",
        "if (sub(7, 3) !== 4) { console.error('FAIL sub', sub(7, 3)); process.exit(1); }",
        "console.log('PASS');",
      ].join("\n"), "utf8");
    } else {
      await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 3; }\n", "utf8");
      await writeFile(join(dir, "test.js"), [
        "import { double } from './src/calc.js';",
        "if (double(4) !== 8) { console.error('FAIL', double(4)); process.exit(1); }",
        "console.log('PASS');",
      ].join("\n"), "utf8");
    }
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2), "utf8");

    if (mode !== "A" && mode !== "E") {
      await writeFile(join(dir, "moah.config.json"), JSON.stringify(configFor(mode), null, 2), "utf8");
      await copyFile(helloSource, join(dir, "hello.ts"));
      const indexed = await run(dir, process.execPath, [bin, "index"]);
      if (indexed.code !== 0) throw new Error(`index failed: ${indexed.stderr}`);
    }

    let command: string;
    let args: string[];
    if (mode === "E") {
      command = "opencode.cmd";
      args = ["run", "--format", "json", "--model", "openrouter/openai/gpt-4o-mini", prompt];
    } else if (mode === "A") {
      command = process.execPath;
      args = [piCli, "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-e", helloSource, "-p", prompt];
    } else {
      command = process.execPath;
      args = [bin, "pi", "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-p", prompt];
    }

    const result = await run(dir, command, args);
    const verify = await run(dir, process.execPath, ["test.js"]);
    const success = verify.code === 0;
    const mainUsage = mode === "E" ? openCodeUsage(result.stdout) : sumMessageUsage(result.stdout);
    const trace = mode === "A" || mode === "E" ? { routerTokens: 0, routerCalls: 0, loads: 0, hits: 0 } : await traceMetrics(dir);
    const freshMainTotal = mainUsage.input + mainUsage.output + mainUsage.cacheWrite;
    const total = freshMainTotal + trace.routerTokens;

    return {
      mode,
      task: taskName,
      success,
      exitCode: result.code,
      elapsedMs: result.elapsedMs,
      mainInput: mainUsage.input,
      mainOutput: mainUsage.output,
      mainCacheRead: mainUsage.cacheRead,
      mainCacheWrite: mainUsage.cacheWrite,
      mainProcessedTotal: mainUsage.processedTotal,
      mainFreshTotal: freshMainTotal,
      routerInputTokens: trace.routerTokens,
      routerCalls: trace.routerCalls,
      totalTokens: total,
      streamLoads: trace.loads,
      cacheHits: trace.hits,
      toolEvents: (result.stdout.match(/"type":"tool_execution_end"/g) ?? []).length,
      stderrTail: result.stderr.trim().split(/\r?\n/).slice(-2).join("\n"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const modes: Harness[] = ["A", "B", "C", "D", "E"];
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
