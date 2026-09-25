import { fork, spawn, type ChildProcess, type ForkOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  update?: (value: unknown) => void;
  cleanup: () => void;
}

/**
 * Owns exactly one streamable package worker process.
 *
 * Closing the child is the authoritative physical-unload boundary. Execution
 * timeouts and aborts terminate the worker rather than replaying a call that
 * may already have performed a side effect.
 */
export class PackageWorkerClient {
  readonly child: ChildProcess;
  rss = 0;
  readonly stages: Array<{ stage: string; ts: number; rss?: number }> = [];

  private pending = new Map<string, PendingRequest>();
  private closed = false;
  private exited: Promise<void>;

  constructor(cwd: string) {
    const compiled = new URL("./package-worker.js", import.meta.url);
    const source = new URL("./package-worker.ts", import.meta.url);
    const useCompiled = existsSync(compiled);
    const execArgv = useCompiled
      ? []
      : ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href];
    const options: ForkOptions & { windowsHide: boolean } = {
      cwd,
      execPath: process.execPath,
      execArgv,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    };

    this.stages.push({ stage: "parent_before_spawn", ts: Date.now(), rss: process.memoryUsage().rss });
    this.child = fork(fileURLToPath(useCompiled ? compiled : source), [], options);
    this.stages.push({ stage: "parent_after_spawn", ts: Date.now(), rss: process.memoryUsage().rss });
    this.exited = new Promise(resolve => {
      this.child.once("exit", () => resolve());
      this.child.once("error", () => resolve());
    });

    this.child.on("message", (message: any) => {
      if (typeof message?.rss === "number") this.rss = message.rss;
      if (typeof message?.stage === "string") {
        this.stages.push({ stage: message.stage, ts: message.ts, rss: message.rss });
      }
      const pending = this.pending.get(message?.id);
      if (!pending) return;

      if ("update" in message) {
        try {
          pending.update?.(message.update);
        } catch {
          // Rendering or streaming must not break worker IPC.
        }
        return;
      }

      this.pending.delete(message.id);
      pending.cleanup();
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });

    this.child.on("error", error => {
      this.closed = true;
      this.failAll(error);
    });

    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.failAll(new Error(`Tool process exited (${signal ?? code})`));
    });
  }

  get alive(): boolean {
    return !this.closed && this.child.exitCode === null && this.child.signalCode === null;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(
    op: string,
    data: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
    update?: (value: unknown) => void,
  ): Promise<any> {
    if (!this.alive) return Promise.reject(new Error("Tool process is closed"));
    if (signal?.aborted) return Promise.reject(new Error("Tool call aborted"));

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = (reason: string) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        cleanup();
        reject(new Error(reason));
        // No automatic replay after a dispatched call.
        void this.close();
      };

      const abort = () => cancel("Tool call aborted; process terminated");
      const timer = setTimeout(() => cancel(`Tool process timeout after ${timeoutMs}ms`), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };

      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve, reject, update, cleanup });

      this.child.send({ ...data, id, op }, error => {
        if (error) {
          this.pending.delete(id);
          cleanup();
          reject(error);
          void this.close();
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.exited;
      return;
    }

    this.closed = true;
    this.failAll(new Error("Tool process closed"));

    const pid = this.child.pid;
    if (process.platform === "win32" && pid && this.child.exitCode === null) {
      await new Promise<void>(resolve => {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("error", () => {
          this.child.kill();
          resolve();
        });
        killer.once("exit", () => {
          if (this.child.exitCode === null) this.child.kill("SIGKILL");
          resolve();
        });
      });
    } else {
      this.child.kill("SIGKILL");
    }

    await this.exited;
  }
}
