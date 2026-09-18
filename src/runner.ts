import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

export interface BenchmarkTask {
  id: string;
  prompt: string;
  files?: Record<string, string>;
  verify: string;
  oracleTools?: string[];
  requiredTools?: string[];
}

export interface BenchmarkSuite {
  suite: string;
  repetitions: number;
  timeoutMs: number;
  profiles: string[];
  tasks: BenchmarkTask[];
  mainArgs?: string[];
  opencodeModel?: string;
}

export interface RunResult {
  runId: string;
  suite: string;
  taskId: string;
  profile: string;
  repetition: number;
  success: boolean;
  exitCode: number | null;
  elapsedMs: number;
  timeout: boolean;
  stdoutTail: string;
  stderrTail: string;
  traceMetrics: Record<string, unknown>;
  mainMetrics: Record<string, unknown>;
  totalCost: number;
}

function cliEntry(): { command: string; nodeArgs: string[] } {
  const compiled = new URL("./cli.js", import.meta.url);
  const source = new URL("./cli.ts", import.meta.url);
  const compiledPath = fileURLToPath(compiled);
  const sourcePath = fileURLToPath(source);
  if (existsSync(compiledPath)) return { command: process.execPath, nodeArgs: [compiledPath] };
  return { command: process.execPath, nodeArgs: ["--import", "tsx", sourcePath] };
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; shell?: boolean },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; elapsedMs: number }> {
  return new Promise(resolveResult => {
    const start = performance.now();
    const child = spawn(command, options.shell ? [] : args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: options.shell ?? false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut: false, elapsedMs: performance.now() - start });
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr, timedOut, elapsedMs: performance.now() - start });
    });
  });
}

function tail(value: string, length = 2000): string {
  return value.length > length ? value.slice(-length) : value;
}

function parseJsonEvents(stdout: string): any[] {
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); } catch { return undefined; }
    })
    .filter((event): event is any => event !== undefined);
}

function collectMainMetrics(stdout: string): Record<string, unknown> {
  const events = parseJsonEvents(stdout);
  const usageEvents = events.filter(event => event?.type === "message_update" && event.usage);
  const messageEndEvents = events.filter(event => event?.type === "message_end");
  const lastMessageEnd = messageEndEvents.at(-1);
  const usage = lastMessageEnd?.message?.usage ?? lastMessageEnd?.usage ?? usageEvents.at(-1)?.usage;
  const toolEvents = events.filter(event => ["tool_result", "toolcall_end", "toolcall_start"].includes(event?.type));
  const finalMessage = lastMessageEnd?.message;
  const finalText = Array.isArray(finalMessage?.content)
    ? finalMessage.content
        .filter((part: any) => part?.type === "text")
        .map((part: any) => part.text)
        .join("\n")
    : undefined;
  return {
    eventCount: events.length,
    messageEndEvents: messageEndEvents.length,
    usageEvents: usageEvents.length,
    toolEvents: toolEvents.length,
    ...(usage ? { usage } : {}),
    ...(finalText !== undefined ? { finalText: tail(finalText, 3000) } : {}),
  };
}

async function collectTraceMetrics(cwd: string): Promise<Record<string, unknown>> {
  const traceDir = join(cwd, ".moah", "traces");
  const files = await readdir(traceDir).catch(() => [] as string[]);
  const events: any[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const lines = (await readFile(join(traceDir, file), "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { /* ignore malformed local trace line */ }
    }
  }
  const routerEvents = events.filter(event => event.event === "router");
  const failedRouters = events.filter(event => event.event === "router_failed").length;
  const selections = events.filter(event => event.event === "selection");
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
  };
  for (const event of routerEvents) {
    const u = event.usage;
    if (!u) continue;
    usage.inputTokens += Number(u.inputTokens ?? 0);
    usage.outputTokens += Number(u.outputTokens ?? 0);
    usage.totalTokens += Number(u.totalTokens ?? 0);
    usage.cacheReadTokens += Number(u.cacheReadTokens ?? 0);
    usage.cost += Number(u.cost ?? 0);
  }
  return {
    routerCalls: routerEvents.length,
    routerFailures: failedRouters,
    selectionEvents: selections.length,
    usage,
    lastSelections: selections.slice(-3).map(event => event.selected ?? []),
  };
}

export async function runSingle(
  suitePath: string,
  cwd: string,
  selection: { taskId: string; profile: string; repetition: number },
): Promise<RunResult> {
  const suite = JSON.parse(await readFile(resolve(suitePath), "utf8")) as BenchmarkSuite;
  if (!suite.suite || !Array.isArray(suite.profiles) || !Array.isArray(suite.tasks) ||
      !Number.isFinite(suite.timeoutMs) || suite.timeoutMs <= 0) {
    throw new Error("Invalid benchmark suite");
  }
  const task = suite.tasks.find(candidate => candidate.id === selection.taskId);
  if (!task) throw new Error(`Unknown task: ${selection.taskId}`);
  if (!suite.profiles.includes(selection.profile)) throw new Error(`Unknown profile: ${selection.profile}`);
  if (!Number.isInteger(selection.repetition) || selection.repetition < 1) throw new Error("Invalid repetition");

  const { command, nodeArgs } = cliEntry();
  const rootConfig = await readFile(join(cwd, "moah.config.json"), "utf8");
  const workspace = await mkdtemp(join(tmpdir(), "moah-bench-"));
  const runId = randomUUID();
  try {
    await writeFile(join(workspace, "moah.config.json"), rootConfig, "utf8");
    for (const [path, content] of Object.entries(task.files ?? {})) {
      const target = join(workspace, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (selection.profile === "moah-oracle" && task.oracleTools) {
      env.MOAH_ORACLE_TOOLS = task.oracleTools.join(",");
    }

    if (selection.profile !== "pi-default" && selection.profile !== "opencode") {
      await runCommand(command, [...nodeArgs, "index"], { cwd: workspace, env, timeoutMs: suite.timeoutMs });
    }

    const measured = selection.profile === "opencode"
      ? await runCommand(
          process.platform === "win32" ? "opencode.cmd" : "opencode",
          ["run", "--format", "json", "--model", suite.opencodeModel ?? "openrouter/openai/gpt-4o-mini", task.prompt],
          { cwd: workspace, env, timeoutMs: suite.timeoutMs },
        )
      : await runCommand(
          command,
          [...nodeArgs, "baseline", selection.profile, "--mode", "json", ...(suite.mainArgs ?? []), task.prompt],
          { cwd: workspace, env, timeoutMs: suite.timeoutMs },
        );

    const verify = await runCommand(task.verify, [], {
      cwd: workspace,
      env,
      timeoutMs: suite.timeoutMs,
      shell: true,
    });
    const traceMetrics = selection.profile.startsWith("moah-") ? await collectTraceMetrics(workspace) : {};
    const mainMetrics = collectMainMetrics(measured.stdout);
    const mainCost = Number((mainMetrics.usage as any)?.cost?.total ?? 0);
    const routerCost = Number((traceMetrics.usage as any)?.cost ?? 0);

    return {
      runId,
      suite: suite.suite,
      taskId: task.id,
      profile: selection.profile,
      repetition: selection.repetition,
      success: verify.code === 0,
      exitCode: measured.code,
      elapsedMs: measured.elapsedMs,
      timeout: measured.timedOut,
      stdoutTail: tail(measured.stdout),
      stderrTail: tail(measured.stderr),
      traceMetrics,
      mainMetrics,
      totalCost: mainCost + routerCost,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export async function runSuite(suitePath: string, cwd: string, dryRun = false): Promise<RunResult[]> {
  const suite = JSON.parse(await readFile(resolve(suitePath), "utf8")) as BenchmarkSuite;
  if (!suite.suite || !Array.isArray(suite.profiles) || !Array.isArray(suite.tasks) ||
      !Number.isInteger(suite.repetitions) || suite.repetitions < 1 ||
      !Number.isFinite(suite.timeoutMs) || suite.timeoutMs <= 0) {
    throw new Error("Invalid benchmark suite");
  }

  const results: RunResult[] = [];
  if (dryRun) {
    for (const task of suite.tasks) {
      for (const profile of suite.profiles) {
        for (let repetition = 1; repetition <= suite.repetitions; repetition++) {
          results.push({
            runId: randomUUID(), suite: suite.suite, taskId: task.id, profile,
            repetition, success: false, exitCode: null, elapsedMs: 0, timeout: false,
            stdoutTail: "", stderrTail: "", traceMetrics: {}, mainMetrics: {}, totalCost: 0,
          });
        }
      }
    }
    return results;
  }

  const { command, nodeArgs } = cliEntry();
  const rootConfig = await readFile(join(cwd, "moah.config.json"), "utf8");
  const outputRoot = join(cwd, ".moah", "benchmark-runs", `run-${Date.now()}-${randomUUID().slice(0, 6)}`);
  await mkdir(outputRoot, { recursive: true });

  for (const task of suite.tasks) {
    for (const profile of suite.profiles) {
      for (let repetition = 1; repetition <= suite.repetitions; repetition++) {
        const workspace = await mkdtemp(join(tmpdir(), "moah-bench-"));
        const runId = randomUUID();
        try {
          await writeFile(join(workspace, "moah.config.json"), rootConfig, "utf8");
          for (const [path, content] of Object.entries(task.files ?? {})) {
            const target = join(workspace, path);
            await mkdir(resolve(target, ".."), { recursive: true });
            await writeFile(target, content, "utf8");
          }

          const env: NodeJS.ProcessEnv = { ...process.env };
          if (profile === "moah-oracle" && task.oracleTools) {
            env.MOAH_ORACLE_TOOLS = task.oracleTools.join(",");
          }

          if (profile !== "pi-default" && profile !== "opencode") {
            await runCommand(command, [...nodeArgs, "index"], { cwd: workspace, env, timeoutMs: suite.timeoutMs });
          }

          const measured = profile === "opencode"
            ? await runCommand(
                process.platform === "win32" ? "opencode.cmd" : "opencode",
                ["run", "--format", "json", "--model", suite.opencodeModel ?? "openrouter/openai/gpt-4o-mini", task.prompt],
                { cwd: workspace, env, timeoutMs: suite.timeoutMs },
              )
            : await runCommand(
                command,
                [...nodeArgs, "baseline", profile, "--mode", "json", ...(suite.mainArgs ?? []), task.prompt],
                { cwd: workspace, env, timeoutMs: suite.timeoutMs },
              );

          const verify = await runCommand(task.verify, [], {
            cwd: workspace,
            env,
            timeoutMs: suite.timeoutMs,
            shell: true,
          });
          const success = verify.code === 0;
          const traceMetrics = profile.startsWith("moah-") ? await collectTraceMetrics(workspace) : {};
          const mainMetrics = collectMainMetrics(measured.stdout);
          const mainCost = Number((mainMetrics.usage as any)?.cost?.total ?? 0);
          const routerCost = Number((traceMetrics.usage as any)?.cost ?? 0);

          results.push({
            runId,
            suite: suite.suite,
            taskId: task.id,
            profile,
            repetition,
            success,
            exitCode: measured.code,
            elapsedMs: measured.elapsedMs,
            timeout: measured.timedOut,
            stdoutTail: tail(measured.stdout),
            stderrTail: tail(measured.stderr),
            traceMetrics,
            mainMetrics,
            totalCost: mainCost + routerCost,
          });
        } finally {
          await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
      }
    }
  }

  const summary = {
    suite: suite.suite,
    outputRoot,
    results,
  };
  await writeFile(join(outputRoot, "results.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  return results;
}
