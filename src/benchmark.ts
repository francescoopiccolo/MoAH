import { spawn, spawnSync } from "node:child_process";
import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { buildCatalog, readCatalog } from "./catalog.js";
import { readConfig, stateDir, writeJson } from "./config.js";

interface BenchmarkTask { id: string; prompts: string[]; files: Record<string, string>; verify: string }
interface BenchmarkSuite { name: string; provider: string; model: string; timeoutMs: number; repetitions: number; tasks: BenchmarkTask[]; modes?: string[]; measureMemory?: boolean; configFile?: string; observeProvider?: boolean; cacheCohort?: string }
export function checkedPath(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) ||
      ["moah.config.json", "agent-events.jsonl", "agent-stderr.log", "memory-samples.jsonl", "provider-metrics.jsonl"].includes(rel.toLowerCase()) ||
      rel.split(/[\\/]/).some(p => [".moah", ".pi", "node_modules"].includes(p))) throw new Error(`Invalid benchmark fixture path: ${path}`);
  return target;
}

export function summarizeUsage(events: any[]) {
  const messages = events.filter(e => e.type === "message_end" && e.message?.role === "assistant").map(e => e.message);
  const used = messages.filter(m => m.usage);
  const complete = used.length > 0 && used.length === messages.length;
  const sum = (key: string) => complete && used.every(m => typeof m.usage[key] === "number") ? used.reduce((n, m) => n + m.usage[key], 0) : null;
  return { responses: messages.length, input: sum("input"), output: sum("output"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite"),
    estimatedCostUsd: complete && used.every(m => typeof m.usage.cost?.total === "number") ? used.reduce((n, m) => n + m.usage.cost.total, 0) : null,
    usageMissing: messages.length === 0 || used.length !== messages.length,
    modelErrors: messages.filter(m => ["error", "aborted"].includes(m.stopReason)).map(m => m.errorMessage ?? m.stopReason) };
}

export async function runBounded(command: string, args: string[], cwd: string, timeoutMs: number, capture?: { stdoutFile: string; stderrFile: string; memoryFile?: string }) {
  const start = performance.now();
  if (capture) { writeFileSync(capture.stdoutFile, ""); writeFileSync(capture.stderrFile, ""); }
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const monitorScript = [new URL("../scripts/measure-tree.ps1", import.meta.url), new URL("../../scripts/measure-tree.ps1", import.meta.url)].find(p => existsSync(p));
  const monitor = process.platform === "win32" && capture?.memoryFile && child.pid && monitorScript
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", fileURLToPath(monitorScript), "-RootProcessId", String(child.pid), "-OutputPath", capture.memoryFile], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }) : undefined;
  const monitorFailure = (detail: string) => {
    if (capture?.memoryFile) appendFileSync(capture.memoryFile, JSON.stringify({ error: "Memory monitor failed", detail }) + "\n");
  };
  let monitorStderr = "";
  monitor?.stderr?.on("data", chunk => { monitorStderr = (monitorStderr + chunk.toString()).slice(0, 4096); });
  monitor?.on("error", error => monitorFailure(error.message));
  monitor?.on("close", code => { if (code !== null && code !== 0) monitorFailure(monitorStderr || `Exit code ${code}`); });
  let stdout = "", stderr = "", timedOut = false;
  const stop = () => {
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => child.kill("SIGKILL"));
      killer.once("close", () => { if (child.exitCode === null) child.kill("SIGKILL"); });
    } else child.kill("SIGKILL");
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  // Prevent an accidental endless log from consuming the runner's memory.
  child.stdout.on("data", chunk => { if (stdout.length < 32 * 1024 ** 2) { stdout += chunk.toString(); if (capture) appendFileSync(capture.stdoutFile, chunk); } else stop(); });
  child.stderr.on("data", chunk => { if (stderr.length < 4 * 1024 ** 2) { stderr += chunk.toString(); if (capture) appendFileSync(capture.stderrFile, chunk); } });
  try {
    const code = await new Promise<number | null>((yes, no) => { child.once("error", no); child.once("close", yes); });
    return { code, timedOut, stdout, stderr, elapsedMs: performance.now() - start };
  } finally { clearTimeout(timer); monitor?.kill(); }
}

export async function readMemorySamples(file: string) {
  const rows = (await readFile(file, "utf8").catch(() => "")).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const samples = rows.filter(r => typeof r.workingSetBytes === "number" && typeof r.privateBytes === "number");
  return { method: "Windows CIM process-tree snapshots; 250ms sleep between polls; shared pages may be counted more than once",
    samples: samples.length, errors: rows.filter(r => r.error).length,
    sampledPeakWorkingSetBytes: samples.length ? Math.max(...samples.map(r => r.workingSetBytes)) : null,
    sampledPeakPrivateBytes: samples.length ? Math.max(...samples.map(r => r.privateBytes)) : null };
}

export async function runBenchmark(suiteFile: string, dryRun: boolean, cwd = process.cwd()) {
  const suite = JSON.parse(await readFile(resolve(cwd, suiteFile), "utf8")) as BenchmarkSuite;
  if (!suite.provider || !suite.model || !Array.isArray(suite.tasks) || !suite.tasks.length ||
      !Number.isInteger(suite.repetitions) || suite.repetitions < 1 || !Number.isFinite(suite.timeoutMs) || suite.timeoutMs <= 0) throw new Error("Invalid benchmark suite");
  for (const task of suite.tasks) {
    if (!/^[\w-]+$/.test(task.id) || !Array.isArray(task.prompts) || !task.prompts.length || task.prompts.some(p => typeof p !== "string") ||
        typeof task.verify !== "string" || !task.files || Object.values(task.files).some(v => typeof v !== "string")) throw new Error("Invalid benchmark task");
    for (const path of Object.keys(task.files)) checkedPath(cwd, path);
    const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: task.verify, encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (syntax.error || syntax.status !== 0) throw new Error(`Invalid verification script for ${task.id}: ${syntax.stderr || syntax.error}`);
  }
  if (new Set(suite.tasks.map(t => t.id)).size !== suite.tasks.length) throw new Error("Duplicate benchmark task IDs");
  const modes = suite.modes ?? ["native", "resident", "streaming"];
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length || modes.some(m => !["native", "resident", "streaming"].includes(m))) throw new Error("Invalid benchmark modes");
  const plan = { name: suite.name, provider: suite.provider, model: suite.model, runs: suite.tasks.length * suite.repetitions * modes.length,
    modes, timeoutMsPerRun: suite.timeoutMs, dryRun };
  console.log(JSON.stringify(plan, null, 2));
  if (dryRun) return plan;
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const auth = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  if (!await auth.checkAuth(suite.provider)) throw new Error(`Configure ${suite.provider} credentials in Pi/environment first. No benchmark requests were made.`);
  const config = await readConfig(resolve(cwd, suite.configFile ?? "moah.config.json"));
  // Alternate benchmark profiles are indexed in their own directory, preserving the user's main catalog.
  let catalog;
  if (suite.configFile) {
    const indexRoot = join(stateDir(cwd), "benchmark-profile-index");
    await mkdir(indexRoot, { recursive: true });
    const absolute = structuredClone(config);
    const { resolvePackage } = await import("./catalog.js");
    absolute.packages = await Promise.all(config.packages.map(async p => ({ ...p, package: undefined, version: undefined, entry: (await resolvePackage(p, cwd)).entry })));
    catalog = await buildCatalog(absolute, indexRoot);
  } else catalog = await readCatalog(config, cwd);
  if (catalog.some(p => p.mode === "unavailable")) throw new Error("Resolve unavailable packages before comparing identical capabilities");
  const root = join(stateDir(cwd), "benchmark-runs");
  await mkdir(root, { recursive: true });
  const runRoot = await mkdtemp(join(root, "run-"));
  await writeJson(join(runRoot, "suite.json"), suite);
  await writeJson(join(runRoot, "package-profile.json"), catalog);
  const results: any[] = [];
  const compiled = new URL("./cli.js", import.meta.url);
  const cliArgs = existsSync(compiled) ? [fileURLToPath(compiled)] : ["--import", "tsx", fileURLToPath(new URL("./cli.ts", import.meta.url))];
  for (let repetition = 0; repetition < suite.repetitions; repetition++) for (const task of suite.tasks) {
    // Rotate order to avoid always giving one condition the first warm provider cache.
    const shift = (repetition + suite.tasks.indexOf(task)) % modes.length;
    for (const mode of [...modes.slice(shift), ...modes.slice(0, shift)]) {
      const workspace = join(runRoot, `${task.id}-${repetition}-${mode}`);
      await mkdir(workspace, { recursive: true });
      for (const [path, text] of Object.entries(task.files)) { const target = checkedPath(workspace, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text); }
      const isolated = structuredClone(config);
      isolated.router.enabled = false; // First comparison isolates model-controlled selection, not semantic retrieval quality.
      isolated.packages = catalog.map(p => ({ id: p.id, entry: p.entry, mode: mode !== "streaming" ? "native" : p.mode as "native" | "stream",
        context: p.context, stateless: p.mode === "stream", workerSdk: p.workerSdk }));
      await writeJson(join(workspace, "moah.config.json"), isolated);
      const publicSnapshot = await readFile(join(stateDir(cwd), "public-catalog.json"), "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return undefined; throw e; });
      if (publicSnapshot) { await mkdir(stateDir(workspace), { recursive: true }); await writeFile(join(stateDir(workspace), "public-catalog.json"), publicSnapshot); }
      const preparationStart = performance.now();
      await buildCatalog(isolated, workspace);
      const preparationMs = performance.now() - preparationStart;
      console.log(`Running ${task.id} / ${mode} / ${repetition + 1}`);
      const invocation = [...cliArgs, mode === "native" ? "dense" : "pi", "--provider", suite.provider, "--model", suite.model,
        ...(suite.observeProvider ? ["-e", fileURLToPath(new URL("../scripts/benchmark-observer." + (existsSync(compiled) ? "js" : "ts"), import.meta.url))] : []),
        "--thinking", "off", "--mode", "json", "--print", "--no-session", "--", ...task.prompts];
      const memoryFile = join(workspace, "memory-samples.jsonl");
      const run = await runBounded(process.execPath, invocation, workspace, suite.timeoutMs, {
        stdoutFile: join(workspace, "agent-events.jsonl"), stderrFile: join(workspace, "agent-stderr.log"),
        ...(suite.measureMemory ? { memoryFile } : {}),
      });
      await writeFile(join(workspace, "agent-events.jsonl"), run.stdout);
      await writeFile(join(workspace, "agent-stderr.log"), run.stderr);
      const events = run.stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const usage = summarizeUsage(events);
      const providerRequests = (await readFile(join(workspace, "provider-metrics.jsonl"), "utf8").catch(() => "")).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const verification = await runBounded(process.execPath, ["--input-type=module", "-e", task.verify], workspace, 15000);
      const traceDir = join(stateDir(workspace), "traces");
      const traces = [];
      for (const path of await readdir(traceDir).catch(() => [] as string[])) for (const line of (await readFile(join(traceDir, path), "utf8")).split(/\r?\n/)) {
        try { traces.push(JSON.parse(line)); } catch { /* blank/incomplete final line */ }
      }
      const result = { task: task.id, mode, repetition, elapsedMs: run.elapsedMs, preparationMs, exitCode: run.code, timedOut: run.timedOut, usage,
        cacheCohort: suite.cacheCohort ?? "uncontrolled-provider-cache", providerRequests,
        perResponseUsage: events.filter(e => e.type === "message_end" && e.message?.role === "assistant").map(e => ({ usage: e.message.usage, responseId: e.message.responseId })),
        passed: run.code === 0 && !run.timedOut && usage.responses > 0 && !usage.modelErrors.length && verification.code === 0 && !verification.timedOut,
        verification: { code: verification.code, output: verification.stdout, error: verification.stderr },
        activations: traces.filter(t => t.event === "activation_requested").length, loads: traces.filter(t => t.event === "load").length,
        evictions: traces.filter(t => t.event === "evict").length,
        toolCalls: events.filter(e => e.type === "tool_execution_start").map(e => e.toolName),
        controlRepeatPauses: traces.filter(t => t.event === "control_repeat_paused").length,
        unchangedActivations: traces.filter(t => t.event === "activation_unchanged").length,
        catalogBytes: traces.filter(t => t.event === "catalog_context").map(t => t.bytes),
        memory: suite.measureMemory ? await readMemorySamples(memoryFile) : null,
        totalProcessPeakRss: null, physicalSsdReadBytes: null, workspace };
      results.push(result);
      await writeJson(join(runRoot, "results.json"), { ...plan, capturedAt: new Date().toISOString(), results });
    }
  }
  console.log(`Benchmark report: ${join(runRoot, "results.json")}`);
  return { runRoot, results };
}
