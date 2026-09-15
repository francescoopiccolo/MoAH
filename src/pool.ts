import { performance } from "node:perf_hooks";
import { ToolProcess } from "./process-client.js";
import { sourceFingerprint } from "./catalog.js";
import type { Config, IndexedPackage, Trace } from "./types.js";

interface Slot { process: ToolProcess; busy: number; lastUsed: number }
export class ProcessPool {
  private slots = new Map<string, Slot>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(private packages: IndexedPackage[], private cwd: string, private options: Config["cache"], private trace: Trace = () => {}) {
    this.packages = packages.filter(p => p.mode === "stream");
    this.timer = setInterval(() => { void this.exclusive(() => this.trim(true)).catch(() => {}); }, Math.min(options.idleTtlMs, 10000));
    this.timer.unref();
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn); this.queue = next.catch(() => {}); return next;
  }
  snapshot() {
    return [...this.slots].map(([id, s]) => ({ id, pid: s.process.pid, rss: s.process.rss, busy: s.busy, alive: s.process.alive }));
  }
  private async evict(id: string, reason: string): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot || slot.busy) return;
    this.slots.delete(id);
    await slot.process.close();
    this.trace("evict", { package: id, reason, pid: slot.process.pid, rss: slot.process.rss });
  }
  private async trim(expired = false): Promise<void> {
    for (const [id, s] of this.slots) {
      if (!s.busy && (!s.process.alive || (expired && Date.now() - s.lastUsed >= this.options.idleTtlMs))) await this.evict(id, "idle");
    }
    while (this.snapshot().reduce((sum, s) => sum + s.rss, 0) > this.options.residentBudgetMb * 1024 ** 2) {
      const oldest = [...this.slots].filter(([, s]) => !s.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) { this.trace("budget_deferred", { reason: "all processes busy" }); break; }
      await this.evict(oldest[0], "budget");
    }
  }
  private async acquire(pkg: IndexedPackage): Promise<Slot> {
    if (this.closed) throw new Error("Pool is closed");
    let slot = this.slots.get(pkg.id);
    if (slot && !slot.process.alive) { this.slots.delete(pkg.id); slot = undefined; }
    if (slot) { slot.busy++; slot.lastUsed = Date.now(); this.trace("cache_hit", { package: pkg.id }); return slot; }
    while (this.slots.size >= this.options.maxProcesses) {
      const oldest = [...this.slots].filter(([, s]) => !s.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) throw new Error("Tool process capacity busy; retry after current calls complete");
      await this.evict(oldest[0], "capacity");
    }
    if (await sourceFingerprint(pkg.root) !== pkg.fingerprint) throw new Error(`Package ${pkg.id} changed since indexing`);
    const start = performance.now();
    const worker = new ToolProcess(this.cwd);
    try {
      const result = await worker.request("load", { entry: pkg.entry, lazySdk: pkg.workerSdk === "lazy" }, this.options.loadTimeoutMs);
      if (JSON.stringify(result.tools) !== JSON.stringify(pkg.tools)) throw new Error(`Tool definitions changed for ${pkg.id}; rebuild catalog`);
      worker.rss = result.rss;
      slot = { process: worker, busy: 1, lastUsed: Date.now() };
      this.slots.set(pkg.id, slot);
      this.trace("load", { package: pkg.id, pid: worker.pid, rss: worker.rss, elapsedMs: performance.now() - start });
      return slot;
    } catch (error) { await worker.close(); throw error; }
  }
  async warm(toolNames: string[]): Promise<void> {
    const needed = this.packages.filter(p => p.tools.some(t => toolNames.includes(t.name))).slice(0, this.options.maxProcesses);
    for (const pkg of needed) {
      await this.exclusive(async () => { const slot = await this.acquire(pkg); slot.busy--; await this.trim(); });
    }
  }
  async releaseUnused(toolNames: string[]): Promise<void> {
    const needed = new Set(this.packages.filter(p => p.tools.some(t => toolNames.includes(t.name))).map(p => p.id));
    await this.exclusive(async () => {
      for (const id of [...this.slots.keys()]) if (!needed.has(id)) await this.evict(id, "deselected");
    });
  }
  async execute(name: string, args: unknown, callId: string, signal?: AbortSignal, onUpdate?: (v: any) => void): Promise<any> {
    if (signal?.aborted) throw new Error("Tool call aborted");
    const pkg = this.packages.find(p => p.tools.some(t => t.name === name));
    if (!pkg) throw new Error(`Unknown streamed tool: ${name}`);
    const slot = await this.exclusive(() => this.acquire(pkg));
    const start = performance.now();
    try {
      const result = await slot.process.request("call", { name, args, callId, cwd: this.cwd }, this.options.callTimeoutMs, signal, onUpdate);
      this.trace("tool_complete", { name, package: pkg.id, elapsedMs: performance.now() - start, rss: slot.process.rss });
      return result;
    } finally {
      await this.exclusive(async () => { slot.busy--; slot.lastUsed = Date.now(); await this.trim(); });
    }
  }
  async close(): Promise<void> {
    clearInterval(this.timer); this.closed = true;
    await this.exclusive(async () => {
      await Promise.all([...this.slots.values()].map(s => s.process.close())); this.slots.clear();
    });
  }
}
