import { fork, spawn, type ChildProcess, type ForkOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export class ToolProcess {
  readonly child: ChildProcess;
  rss = 0;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; update?: (v: any) => void; cleanup: () => void }>();
  private closed = false;
  private exited: Promise<void>;
  constructor(cwd: string) {
    const compiled = new URL("./tool-worker.js", import.meta.url);
    const source = new URL("./tool-worker.ts", import.meta.url);
    const useCompiled = existsSync(compiled);
    const options: ForkOptions & { windowsHide: boolean } = {
      cwd, execPath: process.execPath, execArgv: useCompiled ? [] : ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
    };
    this.child = fork(fileURLToPath(useCompiled ? compiled : source), [], options);
    this.exited = new Promise(resolve => { this.child.once("exit", () => resolve()); this.child.once("error", () => resolve()); });
    this.child.on("message", (message: any) => {
      if (typeof message.rss === "number") this.rss = message.rss;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if ("update" in message) { try { pending.update?.(message.update); } catch { /* rendering must not break IPC */ } return; }
      this.pending.delete(message.id); pending.cleanup();
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    this.child.on("error", error => { this.closed = true; this.failAll(error); });
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.failAll(new Error(`Tool process exited (${signal ?? code})`));
    });
  }
  get alive(): boolean { return !this.closed && this.child.exitCode === null && this.child.signalCode === null; }
  get pid(): number | undefined { return this.child.pid; }
  private failAll(error: Error): void {
    for (const p of this.pending.values()) { p.cleanup(); p.reject(error); }
    this.pending.clear();
  }
  request(op: string, data: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal, update?: (v: any) => void): Promise<any> {
    if (!this.alive) return Promise.reject(new Error("Tool process is closed"));
    if (signal?.aborted) return Promise.reject(new Error("Tool call aborted"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = (reason: string) => {
        this.pending.delete(id); cleanup(); reject(new Error(reason));
        // No automatic replay: a tool may already have performed a side effect.
        void this.close();
      };
      const abort = () => cancel("Tool call aborted; process terminated");
      const timer = setTimeout(() => cancel(`Tool process timeout after ${timeoutMs}ms`), timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve, reject, update, cleanup });
      this.child.send({ ...data, id, op }, error => {
        if (error) { this.pending.delete(id); cleanup(); reject(error); void this.close(); }
      });
    });
  }
  async close(): Promise<void> {
    if (this.closed) { await this.exited; return; }
    this.closed = true;
    this.failAll(new Error("Tool process closed"));
    const pid = this.child.pid;
    if (process.platform === "win32" && pid && this.child.exitCode === null) {
      await new Promise<void>(resolve => {
        const kill = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        kill.once("error", () => { this.child.kill(); resolve(); });
        kill.once("exit", () => { if (this.child.exitCode === null) this.child.kill("SIGKILL"); resolve(); });
      });
    } else { this.child.kill("SIGKILL"); }
    await this.exited;
  }
}
