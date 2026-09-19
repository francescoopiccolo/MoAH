import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(".");
const bin = join(repo, "bin", "moah.mjs");
const piCli = join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const helloSource = join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "examples", "extensions", "hello.ts");
const task = process.env.TASK ?? "bugfix";
const trials = Number(process.env.TRIALS ?? "3");
const modes = ["A", "D", "E"] as const;

const prompts: Record<string, string> = {
  repository:
    "Explain where double is implemented and which file tests it. Write answer.txt containing the implementation file and the test file.",
  search:
    "Find where sub is implemented and write the exact expression used in the implementation to answer.txt.",
  bugfix:
    "Fix the double function in src/calc.js so that `node test.js` passes. Run `node test.js` to verify your fix.",
  feature:
    "Add the missing sub function to src/calc.js so that `node test.js` passes. Run `node test.js` to verify.",
  multifile:
    "Fix triple in src/utils.js so that `node test.js` passes. Run `node test.js` to verify.",
};

function configD() {
  return {
    baseline: { enabled: true },
    router: { enabled: true, mode: "auto", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKeyEnv: "MOAH_ROUTER_API_KEY", maxTools: 6, baseTools: ["read", "bash", "powershell", "edit", "write"] },
    streaming: { enabled: true, prefetch: true, cold: false, hotPreload: 0, maxProcesses: 2, residentBudgetMb: 512, idleTtlMs: 120000, loadTimeoutMs: 30000, callTimeoutMs: 30000, estimatedRssMb: 64 },
    packages: [{ id: "hello", entry: "hello.ts", mode: "stream", stateless: true, workerSdk: "lazy" }],
  };
}

async function run(cwd: string, command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number | null; elapsedMs: number }>(resolveResult => {
    const start = Date.now();
    const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && command.endsWith(".cmd") });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", c => { stdout += c; });
    child.stderr.on("data", c => { stderr += c; });
    child.on("close", code => resolveResult({ stdout, stderr, code, elapsedMs: Date.now() - start }));
  });
}

function sumMessageUsage(stdout: string) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, processed: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('"type":"message_end"')) continue;
    try {
      const obj = JSON.parse(line);
      const u = obj?.message?.usage;
      if (!u) continue;
      totals.input += Number(u.input ?? 0);
      totals.output += Number(u.output ?? 0);
      totals.cacheRead += Number(u.cacheRead ?? 0);
      totals.cacheWrite += Number(u.cacheWrite ?? 0);
      totals.processed += Number(u.totalTokens ?? u.total ?? 0);
    } catch { /* ignore */ }
  }
  return totals;
}

function openCodeUsage(stdout: string) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, processed: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('"type":"step_finish"')) continue;
    try {
      const obj = JSON.parse(line);
      const t = obj?.part?.tokens;
      if (!t) continue;
      totals.input += Number(t.input ?? 0);
      totals.output += Number(t.output ?? 0);
      totals.cacheRead += Number(t.cache?.read ?? 0);
      totals.cacheWrite += Number(t.cache?.write ?? 0);
      totals.processed += Number(t.total ?? 0);
    } catch { /* ignore */ }
  }
  return totals;
}

async function traceMetrics(dir: string) {
  const traceDir = join(dir, ".moah", "traces");
  const files = await readdir(traceDir).catch(() => [] as string[]);
  let routerTokens = 0;
  let routerCalls = 0;
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
      } catch { /* ignore */ }
    }
  }
  return { routerTokens, routerCalls };
}

async function setup(dir: string) {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  if (task === "bugfix") {
    await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 3; }\n", "utf8");
    await writeFile(join(dir, "test.js"), "import { double } from './src/calc.js';\nif (double(4) !== 8) process.exit(1);\nconsole.log('PASS');\n", "utf8");
  } else if (task === "feature" || task === "repository" || task === "search") {
    await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 2; }\nexport function sub(a, b) { return a - b; }\n", "utf8");
    await writeFile(join(dir, "test.js"), "import { double, sub } from './src/calc.js';\nif (double(4) !== 8) process.exit(1);\nif (sub(7, 3) !== 4) process.exit(1);\nconsole.log('PASS');\n", "utf8");
  } else if (task === "multifile") {
    await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 2; }\n", "utf8");
    await writeFile(join(dir, "src", "utils.js"), "export function triple(n) { return n * 2; }\n", "utf8");
    await writeFile(join(dir, "test.js"), "import { triple } from './src/utils.js';\nif (triple(3) !== 9) process.exit(1);\nconsole.log('PASS');\n", "utf8");
  }
}

async function verify(dir: string): Promise<boolean> {
  if (task === "repository" || task === "search") {
    const answer = await readFile(join(dir, "answer.txt"), "utf8").catch(() => "");
    if (task === "repository") return answer.includes("src/calc.js") && answer.includes("test.js");
    if (task === "search") return answer.includes("a - b");
  }
  const r = await run(dir, process.execPath, ["test.js"]);
  return r.code === 0;
}

async function trial(mode: "A" | "D" | "E"): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), "moah-final-"));
  try {
    await setup(dir);
    if (mode === "D") {
      await writeFile(join(dir, "moah.config.json"), JSON.stringify(configD(), null, 2), "utf8");
      await copyFile(helloSource, join(dir, "hello.ts"));
      const idx = await run(dir, process.execPath, [bin, "index"]);
      if (idx.code !== 0) throw new Error(idx.stderr);
    }
    let command = process.execPath;
    let args: string[];
    if (mode === "E") {
      command = "opencode.cmd";
      args = ["run", "--format", "json", "--model", "openrouter/openai/gpt-4o-mini", prompts[task]];
    } else if (mode === "A") {
      args = [piCli, "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-e", helloSource, "-p", prompts[task]];
    } else {
      args = [bin, "pi", "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-p", prompts[task]];
    }
    const result = await run(dir, command, args);
    const ok = await verify(dir);
    const usage = mode === "E" ? openCodeUsage(result.stdout) : sumMessageUsage(result.stdout);
    const trace = mode === "D" ? await traceMetrics(dir) : { routerTokens: 0, routerCalls: 0 };
    const fresh = usage.input + usage.output + usage.cacheWrite + trace.routerTokens;
    return {
      task,
      mode,
      success: ok,
      exitCode: result.code,
      elapsedMs: result.elapsedMs,
      freshInput: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      processed: usage.processed,
      routerTokens: trace.routerTokens,
      routerCalls: trace.routerCalls,
      freshTotal: fresh,
      toolEvents: (result.stdout.match(/"type":"tool_execution_end"/g) ?? []).length,
      stderrTail: result.stderr.trim().split(/\r?\n/).slice(-2).join("\n"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const rows: Record<string, unknown>[] = [];
  for (const mode of modes) {
    for (let i = 1; i <= trials; i++) rows.push(await trial(mode));
  }
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
