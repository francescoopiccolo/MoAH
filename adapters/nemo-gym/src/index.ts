import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

export interface ResourceToolMapping {
  gymName: string;
  piTool: string;
}

export interface RolloutInput {
  taskId: string;
  profile: "pi-default" | "pi-full" | "moah-auto" | "moah-suggest" | "moah-oracle";
  prompt: string;
  files?: Record<string, string>;
  oracleTools?: string[];
  resourceTools?: ResourceToolMapping[];
  metadata?: Record<string, unknown>;
}

export interface RolloutOutput {
  taskId: string;
  profile: string;
  success: boolean;
  elapsedMs: number;
  exitCode: number | null;
  timeout: boolean;
  transcript: unknown[];
  metrics: Record<string, unknown>;
  error?: string;
}

function envPath(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseJsonLines(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); } catch { return undefined; }
    })
    .filter((event): event is unknown => event !== undefined);
}

function collectMetrics(events: any[]): Record<string, unknown> {
  const messageEnd = events.filter(event => event?.type === "message_end").at(-1);
  const usage = messageEnd?.message?.usage ?? messageEnd?.usage;
  const toolEvents = events.filter(event => ["tool_result", "toolcall_start", "toolcall_end"].includes(event?.type));
  return {
    eventCount: events.length,
    toolEvents: toolEvents.length,
    ...(usage ? { usage } : {}),
  };
}

export class MoahProcessAdapter {
  private moahCli: string;
  private configPath: string;

  constructor() {
    this.moahCli = envPath("MOAH_CLI");
    this.configPath = envPath("MOAH_CONFIG");
  }

  async initialize(): Promise<void> {
    await readFile(this.moahCli, "utf8");
    await readFile(this.configPath, "utf8");
  }

  async runRollout(input: RolloutInput, timeoutMs = 180000): Promise<RolloutOutput> {
    const workspace = await mkdtemp(join(tmpdir(), "moah-nemo-"));
    const start = performance.now();
    try {
      await writeFile(join(workspace, "moah.config.json"), await readFile(this.configPath, "utf8"), "utf8");
      for (const [path, content] of Object.entries(input.files ?? {})) {
        await writeFile(join(workspace, path), content, "utf8");
      }

      const env: NodeJS.ProcessEnv = { ...process.env };
      if (input.profile === "moah-oracle" && input.oracleTools) {
        env.MOAH_ORACLE_TOOLS = input.oracleTools.join(",");
      }

      const child = spawn(
        process.execPath,
        [this.moahCli, "baseline", input.profile, "--mode", "json", input.prompt],
        { cwd: workspace, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const result = await new Promise<{ code: number | null }>((resolveResult, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", code => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          resolveResult({ code });
        });
      });

      const transcript = parseJsonLines(stdout);
      const metrics = collectMetrics(transcript);
      return {
        taskId: input.taskId,
        profile: input.profile,
        success: result.code === 0,
        elapsedMs: performance.now() - start,
        exitCode: result.code,
        timeout: timedOut,
        transcript,
        metrics,
        ...(stderr ? { error: stderr.slice(-2000) } : {}),
      };
    } finally {
      await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }

  async shutdown(): Promise<void> {}
}

export async function createAdapter(): Promise<MoahProcessAdapter> {
  const adapter = new MoahProcessAdapter();
  await adapter.initialize();
  return adapter;
}
