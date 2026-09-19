import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(".");
const bin = join(repo, "bin", "moah.mjs");
const piCli = join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const helloSource = join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "examples", "extensions", "hello.ts");
const task = process.env.TASK ?? "bugfix";
const prompt = task === "feature"
  ? "Add the missing sub function to src/calc.js so that `node test.js` passes. Run `node test.js` to verify."
  : "Fix the double function in src/calc.js so that `node test.js` passes. Run `node test.js` to verify your fix.";

function configD() {
  return {
    baseline: { enabled: true },
    router: { enabled: true, mode: "auto", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKeyEnv: "MOAH_ROUTER_API_KEY", maxTools: 6, baseTools: ["read", "bash", "powershell", "edit", "write"] },
    streaming: { enabled: true, prefetch: true, cold: false, hotPreload: 0, maxProcesses: 2, residentBudgetMb: 512, idleTtlMs: 120000, loadTimeoutMs: 30000, callTimeoutMs: 30000, estimatedRssMb: 64 },
    packages: [{ id: "hello", entry: "hello.ts", mode: "stream", stateless: true, workerSdk: "lazy" }],
  };
}

async function run(cwd: string, command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(resolveResult => {
    const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && command.endsWith(".cmd") });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", c => { stdout += c; });
    child.stderr.on("data", c => { stderr += c; });
    child.on("close", code => resolveResult({ stdout, stderr, code }));
  });
}

function piMoahTrace(stdout: string) {
  const rounds: any[] = [];
  let current: any = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === "message_start" && obj.message?.role === "assistant") {
      current = { role: "assistant", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, tools: [] };
    } else if (obj.type === "message_update" && obj.assistantMessageEvent?.type === "toolcall_end") {
      current?.tools.push(obj.assistantMessageEvent.toolCall?.name ?? "?");
    } else if (obj.type === "message_end" && obj.message?.role === "assistant") {
      const u = obj.message.usage ?? {};
      current.input = Number(u.input ?? 0);
      current.output = Number(u.output ?? 0);
      current.cacheRead = Number(u.cacheRead ?? 0);
      current.cacheWrite = Number(u.cacheWrite ?? 0);
      current.total = Number(u.totalTokens ?? u.total ?? 0);
      rounds.push(current);
      current = null;
    }
  }
  const toolExecutions = (stdout.match(/"type":"tool_execution_end"/g) ?? []).length;
  return { rounds, toolExecutions };
}

function openCodeTrace(stdout: string) {
  const rounds: any[] = [];
  const toolUses: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === "step_finish") {
      const t = obj.part?.tokens ?? {};
      rounds.push({
        reason: obj.part?.reason ?? "?",
        input: Number(t.input ?? 0),
        output: Number(t.output ?? 0),
        cacheRead: Number(t.cache?.read ?? 0),
        cacheWrite: Number(t.cache?.write ?? 0),
        total: Number(t.total ?? 0),
        tools: [...toolUses],
      });
      toolUses.length = 0;
    } else if (obj.type === "tool_use") {
      toolUses.push(obj.part?.tool ?? "?");
    }
  }
  return { rounds, toolExecutions: (stdout.match(/"type":"tool_use"/g) ?? []).length };
}

async function main() {
  for (const mode of ["A", "D", "E"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "moah-attribution-"));
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      if (task === "feature") {
        await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 2; }\n", "utf8");
        await writeFile(join(dir, "test.js"), [
          "import { double, sub } from './src/calc.js';",
          "if (double(4) !== 8) process.exit(1);",
          "if (sub(7, 3) !== 4) process.exit(1);",
          "console.log('PASS');",
        ].join("\n"), "utf8");
      } else {
        await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 3; }\n", "utf8");
        await writeFile(join(dir, "test.js"), [
          "import { double } from './src/calc.js';",
          "if (double(4) !== 8) process.exit(1);",
          "console.log('PASS');",
        ].join("\n"), "utf8");
      }
      await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");

      let command = process.execPath;
      let args: string[];
      if (mode === "E") {
        command = "opencode.cmd";
        args = ["run", "--format", "json", "--model", "openrouter/openai/gpt-4o-mini", prompt];
      } else if (mode === "A") {
        args = [piCli, "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-e", helloSource, "-p", prompt];
      } else {
        await writeFile(join(dir, "moah.config.json"), JSON.stringify(configD(), null, 2), "utf8");
        await copyFile(helloSource, join(dir, "hello.ts"));
        const idx = await run(dir, process.execPath, [bin, "index"]);
        if (idx.code !== 0) throw new Error(idx.stderr);
        args = [bin, "pi", "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-p", prompt];
      }
      const result = await run(dir, command, args);
      const trace = mode === "E" ? openCodeTrace(result.stdout) : piMoahTrace(result.stdout);
      console.log(JSON.stringify({ mode, task, rounds: trace.rounds, toolExecutions: trace.toolExecutions, code: result.code }, null, 2));
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
