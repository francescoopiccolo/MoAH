import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(".");
const bin = join(repo, "bin", "moah.mjs");
const artifact = resolve("stream-artifacts/rg.bundle.mjs");

function config() {
  return {
    baseline: { enabled: false },
    router: { enabled: true, mode: "auto", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKeyEnv: "MOAH_ROUTER_API_KEY", maxTools: 6, baseTools: ["read", "bash", "powershell", "edit", "write"] },
    streaming: { enabled: true, prefetch: true, cold: false, hotPreload: 0, maxProcesses: 1, residentBudgetMb: 512, idleTtlMs: 120000, loadTimeoutMs: 30000, callTimeoutMs: 30000, estimatedRssMb: 64 },
    packages: [{ id: "rg", entry: artifact, mode: "stream", stateless: true, workerSdk: "lazy", nativeResident: false }],
  };
}

function run(cwd: string, args: string[]) {
  return new Promise<{ code: number | null; elapsedMs: number; stdout: string; stderr: string }>(resolveResult => {
    const start = Date.now();
    const child = spawn(process.execPath, args, { cwd, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", c => { stdout += c; });
    child.stderr.on("data", c => { stderr += c; });
    child.on("close", code => resolveResult({ code, elapsedMs: Date.now() - start, stdout, stderr }));
  });
}

async function trace(dir: string) {
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

async function trial() {
  const dir = await mkdtemp(join(tmpdir(), "moah-prefetch-repeat-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 2; }\n", "utf8");
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    await writeFile(join(dir, "moah.config.json"), JSON.stringify(config(), null, 2), "utf8");
    await run(dir, [bin, "index"]);
    const result = await run(dir, [bin, "pi", "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-p", "Use ripgrep to search for double in src/calc.js, then report the matching line."]);
    const events = await trace(dir);
    const router = events.find(e => e.event === "router");
    const loadStart = events.find(e => e.event === "stream_load_started");
    const loadComplete = events.find(e => e.event === "stream_load_complete");
    const wait = events.find(e => e.event === "stream_execution_wait");
    const toolUsage = events.find(e => e.event === "usage" && e.usage?.stopReason === "toolUse");
    const loadMs = Number(loadComplete?.elapsedMs ?? 0);
    const loadStartTime = loadStart ? new Date(loadStart.time).getTime() : 0;
    const toolTime = toolUsage ? new Date(toolUsage.time).getTime() : 0;
    const foregroundWait = Number(wait?.waitMs ?? loadMs);
    return {
      routerMs: Number(router?.elapsedMs ?? 0),
      loadMs,
      availableOverlapMs: toolTime && loadStartTime ? Math.max(0, toolTime - loadStartTime) : 0,
      foregroundWaitMs: foregroundWait,
      hiddenFraction: loadMs > 0 ? Math.max(0, 1 - foregroundWait / loadMs) : null,
      e2eMs: result.elapsedMs,
      code: result.code,
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(await trial());
  console.log(JSON.stringify(rows, null, 2));
}

void main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
