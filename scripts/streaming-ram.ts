import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(".");
const bin = join(repo, "bin", "moah.mjs");
const artifact = resolve("stream-artifacts/rg.bundle.mjs");

function config(mode: string) {
  const stream = mode !== "native";
  const pkg: Record<string, unknown> = {
    id: "rg",
    entry: artifact,
  };
  if (stream) {
    Object.assign(pkg, { mode: "stream", stateless: true, workerSdk: "lazy", nativeResident: false });
  } else {
    Object.assign(pkg, { mode: "native", nativeResident: true });
  }
  return {
    baseline: { enabled: false },
    router: { enabled: true, mode: "auto", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKeyEnv: "MOAH_ROUTER_API_KEY", maxTools: 6, baseTools: ["read", "bash", "powershell", "edit", "write"] },
    streaming: { enabled: stream, prefetch: mode === "prefetch", cold: false, hotPreload: 0, maxProcesses: 1, residentBudgetMb: 512, idleTtlMs: 120000, loadTimeoutMs: 30000, callTimeoutMs: 30000, estimatedRssMb: 64 },
    packages: [pkg],
  };
}

function runSync(command: string, args: string[], cwd: string) {
  return new Promise<number | null>(resolveResult => {
    const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: "ignore" });
    child.on("close", code => resolveResult(code));
  });
}

async function samples(path: string) {
  const text = await readFile(path, "utf8").catch(() => "");
  const rows = text.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return undefined; }
  }).filter(x => x && typeof x.workingSetBytes === "number");
  return rows as Array<{ workingSetBytes: number; privateBytes: number; pids: number[] }>;
}

async function measure(mode: string) {
  const dir = await mkdtemp(join(tmpdir(), `moah-ram-${mode}-`));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "calc.js"), "export function double(n) { return n * 2; }\n", "utf8");
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    await writeFile(join(dir, "moah.config.json"), JSON.stringify(config(mode), null, 2), "utf8");
    await runSync(process.execPath, [bin, "index"], dir);

    const child = spawn(process.execPath, [bin, "pi", "--provider", "openrouter", "--model", "openai/gpt-4o-mini", "--mode", "json", "-p", "Use ripgrep to search for double in src/calc.js, then report the matching line."], {
      cwd: dir,
      env: process.env,
      windowsHide: true,
      stdio: "ignore",
    });

    const sampleFile = join(dir, "samples.jsonl");
    const sampler = spawn("powershell.exe", ["-NoProfile", "-File", join(repo, "scripts", "measure-tree.ps1"), "-RootProcessId", String(child.pid), "-OutputPath", sampleFile], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });

    await new Promise<void>(resolveChild => child.once("close", () => resolveChild()));
    await new Promise<void>(resolveSampler => sampler.once("close", () => resolveSampler()));

    const rows = await samples(sampleFile);
    const ws = rows.map(r => r.workingSetBytes);
    const pb = rows.map(r => r.privateBytes);
    const childCounts = rows.map(r => r.pids.length);
    const stat = (arr: number[]) => arr.length ? arr : [0];
    return {
      mode,
      samples: rows.length,
      workingSetMinMB: Number((Math.min(...stat(ws)) / 1024 ** 2).toFixed(1)),
      workingSetMaxMB: Number((Math.max(...stat(ws)) / 1024 ** 2).toFixed(1)),
      workingSetMeanMB: Number((stat(ws).reduce((a, b) => a + b, 0) / stat(ws).length / 1024 ** 2).toFixed(1)),
      privateMinMB: Number((Math.min(...stat(pb)) / 1024 ** 2).toFixed(1)),
      privateMaxMB: Number((Math.max(...stat(pb)) / 1024 ** 2).toFixed(1)),
      maxChildCount: Math.max(...stat(childCounts)),
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  const out = [];
  for (const mode of ["native", "demand", "prefetch"]) out.push(await measure(mode));
  console.log(JSON.stringify(out, null, 2));
}

void main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
