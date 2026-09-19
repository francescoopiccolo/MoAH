import { performance } from "node:perf_hooks";
import { sourceFingerprint } from "../catalog.js";
import type { IndexedPackage, StreamingConfig, ToolMetadata, Trace } from "../types.js";
import { PackageWorkerClient } from "./package-worker-client.js";
import type {
  LoadKind,
  PackageCacheEntrySnapshot,
  PackageCacheSnapshot,
  PackageCacheStats,
  PackageState,
} from "./types.js";

interface ResidentEntry {
  packageId: string;
  worker: PackageWorkerClient;
  tools: ToolMetadata[];
  rss: number;
  pinned: number;
  selected: boolean;
  priority: "foreground" | "selected" | "speculative";
  lastUsed: number;
  loads: number;
  hits: number;
  executions: number;
  loadElapsedMs: number;
}

const MB = 1024 ** 2;

/**
 * Bounded warm-worker cache for streamable packages.
 *
 * The unit of residency is the package. Killing the child process is the only
 * authoritative unload boundary, because Node module caching and arbitrary
 * package side effects make intra-process unload unsafe.
 */
export class PackageCache {
  private readonly packages: IndexedPackage[];
  private readonly residents = new Map<string, ResidentEntry>();
  private readonly loading = new Map<string, Promise<ResidentEntry>>();
  private readonly reserved = new Set<string>();
  private readonly stats: PackageCacheStats = {
    hits: 0,
    misses: 0,
    loads: 0,
    loadFailures: 0,
    evictions: 0,
    foregroundWaits: 0,
    totalLoadMs: 0,
    totalForegroundWaitMs: 0,
  };

  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  private currentTurn = new Set<string>();

  constructor(
    packages: IndexedPackage[],
    private readonly cwd: string,
    private options: StreamingConfig,
    private readonly trace: Trace = () => {},
  ) {
    this.packages = packages.filter(pkg => pkg.mode === "stream");
    this.timer = setInterval(() => {
      void this.enqueue(() => this.trimLocked(true)).catch(() => {});
    }, Math.min(options.idleTtlMs, 10000));
    this.timer.unref();
  }

  async setResidentBudgetMb(residentBudgetMb: number): Promise<void> {
    if (!Number.isFinite(residentBudgetMb) || residentBudgetMb <= 0) {
      throw new Error("residentBudgetMb must be a positive number");
    }
    await this.enqueue(async () => {
      this.options = { ...this.options, residentBudgetMb };
      await this.trimLocked(false);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private state(packageId: string): PackageState {
    if (this.residents.has(packageId)) {
      const entry = this.residents.get(packageId)!;
      if (entry.pinned > 0) return "BUSY";
      if (entry.selected) return "RESIDENT_SELECTED";
      return "RESIDENT_IDLE";
    }
    if (this.loading.has(packageId) || this.reserved.has(packageId)) return "LOADING";
    return "DISK";
  }

  snapshot(): PackageCacheSnapshot {
    const entries: PackageCacheEntrySnapshot[] = [...this.residents.values()].map(entry => ({
      packageId: entry.packageId,
      state: this.state(entry.packageId),
      pid: entry.worker.pid,
      rss: entry.rss,
      pinned: entry.pinned,
      selected: entry.selected,
      priority: entry.priority,
      lastUsed: entry.lastUsed,
      loads: entry.loads,
      hits: entry.hits,
      executions: entry.executions,
    }));

    const currentRssBytes = this.currentRssBytes();
    const estimatedRssBytes = this.estimatedRssBytes();
    return {
      entries,
      loading: [...this.loading.keys()],
      reserved: [...this.reserved],
      stats: { ...this.stats },
      budget: {
        maxProcesses: this.options.maxProcesses,
        currentProcesses: this.residents.size + this.reserved.size,
        residentBudgetBytes: this.options.residentBudgetMb * MB,
        estimatedRssBytes,
        currentRssBytes,
      },
    };
  }

  private estimatedRssBytes(): number {
    return (this.residents.size + this.reserved.size) * this.options.estimatedRssMb * MB;
  }

  private currentRssBytes(): number {
    let bytes = 0;
    for (const entry of this.residents.values()) bytes += entry.rss || this.options.estimatedRssMb * MB;
    bytes += this.reserved.size * this.options.estimatedRssMb * MB;
    return bytes;
  }

  private entryScore(entry: ResidentEntry): number {
    if (entry.pinned > 0) return Number.POSITIVE_INFINITY;
    let score = 0;
    if (entry.selected) score += 1000;
    if (entry.executions > 0) score += Math.min(50, entry.executions * 5);
    score += Math.min(20, entry.hits);
    score -= (Date.now() - entry.lastUsed) / 1000;
    if (entry.priority === "speculative" && entry.executions === 0 && entry.hits === 0) score -= 500;
    return score;
  }

  private pickVictim(kind: LoadKind): ResidentEntry | undefined {
    const candidates = [...this.residents.values()]
      .filter(entry => entry.pinned === 0)
      .filter(entry => (kind === "demand" ? true : !entry.selected));
    candidates.sort((a, b) => this.entryScore(a) - this.entryScore(b));
    return candidates[0];
  }

  private async evict(packageId: string, reason: string): Promise<boolean> {
    const entry = this.residents.get(packageId);
    if (!entry || entry.pinned > 0) return false;

    this.residents.delete(packageId);
    this.stats.evictions++;
    this.trace("stream_evict", {
      package: packageId,
      reason,
      pid: entry.worker.pid,
      rss: entry.rss,
    });
    await entry.worker.close();
    this.trace("stream_worker_exit", { package: packageId, pid: entry.worker.pid });
    return true;
  }

  private async makeRoom(kind: LoadKind, estimatedBytes: number): Promise<void> {
    while (this.residents.size + this.reserved.size >= this.options.maxProcesses) {
      const victim = this.pickVictim(kind);
      if (!victim) {
        if (kind === "demand") {
          throw new Error("Tool process capacity busy; retry after current calls complete");
        }
        throw new Error("No evictable speculative worker; prefetch skipped");
      }
      await this.evict(victim.packageId, "capacity");
    }

    while (this.currentRssBytes() + estimatedBytes > this.options.residentBudgetMb * MB) {
      const victim = this.pickVictim(kind);
      if (!victim) {
        if (kind === "demand") {
          this.trace("stream_budget", {
            reason: "deferred; foreground workers are pinned",
            currentRssBytes: this.currentRssBytes(),
            residentBudgetBytes: this.options.residentBudgetMb * MB,
          });
          return;
        }
        throw new Error("No evictable speculative worker for memory budget");
      }
      await this.evict(victim.packageId, "budget");
    }
  }

  private async loadAndPublish(pkg: IndexedPackage, kind: LoadKind): Promise<ResidentEntry> {
    const start = performance.now();
    this.trace("stream_load_started", {
      package: pkg.id,
      kind,
      pid: undefined,
    });

    if (pkg.sourceFingerprint && (await sourceFingerprint(pkg.root)) !== pkg.sourceFingerprint) {
      throw new Error(`Package ${pkg.id} changed since indexing`);
    }

    const estimatedBytes = this.options.estimatedRssMb * MB;
    await this.makeRoom(kind, estimatedBytes);
    this.reserved.add(pkg.id);

    let worker: PackageWorkerClient | undefined;
    try {
      worker = new PackageWorkerClient(this.cwd);
      const result = await worker.request(
        "load",
        { entry: pkg.entry, lazySdk: pkg.workerSdk !== "full" },
        this.options.loadTimeoutMs,
      );
      const tools = result.tools as ToolMetadata[];
      if (JSON.stringify(tools) !== JSON.stringify(pkg.tools)) {
        throw new Error(`Tool definitions changed for ${pkg.id}; rebuild catalog`);
      }

      const now = Date.now();
      const entry: ResidentEntry = {
        packageId: pkg.id,
        worker,
        tools,
        rss: result.rss,
        pinned: 0,
        selected: this.currentTurn.has(pkg.id),
        priority: kind === "demand"
          ? "foreground"
          : this.currentTurn.has(pkg.id)
            ? "selected"
            : "speculative",
        lastUsed: now,
        loads: 1,
        hits: 0,
        executions: 0,
        loadElapsedMs: performance.now() - start,
      };
      this.reserved.delete(pkg.id);
      this.residents.set(pkg.id, entry);
      this.stats.loads++;
      this.stats.totalLoadMs += entry.loadElapsedMs;
      this.trace("stream_load_complete", {
        package: pkg.id,
        kind,
        pid: worker.pid,
        rss: entry.rss,
        elapsedMs: entry.loadElapsedMs,
      });
      return entry;
    } catch (error) {
      this.reserved.delete(pkg.id);
      this.stats.loadFailures++;
      this.trace("stream_load_failed", {
        package: pkg.id,
        kind,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: performance.now() - start,
      });
      if (worker) await worker.close();
      throw error;
    }
  }

  private async ensureResident(pkg: IndexedPackage, kind: LoadKind): Promise<ResidentEntry> {
    const existing = this.residents.get(pkg.id);
    if (existing && existing.worker.alive) {
      existing.lastUsed = Date.now();
      existing.hits++;
      this.stats.hits++;
      this.trace("stream_cache_hit", { package: pkg.id, kind, pid: existing.worker.pid });
      return existing;
    }

    if (existing && !existing.worker.alive) {
      this.residents.delete(pkg.id);
      this.stats.evictions++;
      await existing.worker.close();
    }

    const inFlight = this.loading.get(pkg.id);
    if (inFlight) return inFlight;

    this.stats.misses++;
    this.trace("stream_cache_miss", { package: pkg.id, kind });
    const loading = this.loadAndPublish(pkg, kind).finally(() => {
      this.loading.delete(pkg.id);
    });
    this.loading.set(pkg.id, loading);
    return loading;
  }

  beginTurn(packageIds: Iterable<string>): void {
    if (this.closed) return;
    this.currentTurn = new Set(packageIds);
    for (const entry of this.residents.values()) {
      entry.selected = this.currentTurn.has(entry.packageId);
      if (entry.selected && entry.pinned === 0) entry.priority = "selected";
    }
  }

  prefetch(packageIds: string[], reason: string): Promise<void> {
    if (this.closed || !this.options.enabled || this.options.cold || !this.options.prefetch) {
      return Promise.resolve();
    }

    this.trace("stream_prefetch_started", { packages: packageIds, reason });
    return this.enqueue(async () => {
      for (const packageId of packageIds.slice(0, this.options.maxProcesses)) {
        const pkg = this.packages.find(candidate => candidate.id === packageId);
        if (!pkg) continue;
        try {
          await this.ensureResident(pkg, "speculative");
        } catch {
          // Speculative misses must never break the foreground agent path.
        }
      }
    });
  }

  preloadHot(count: number): Promise<void> {
    if (this.closed || count <= 0 || this.options.cold || !this.options.enabled) {
      return Promise.resolve();
    }
    const packageIds = this.packages.slice(0, count).map(pkg => pkg.id);
    return this.prefetch(packageIds, "hot-preload");
  }

  async execute(
    toolName: string,
    packageId: string,
    args: unknown,
    callId: string,
    signal?: AbortSignal,
    onUpdate?: (value: unknown) => void,
  ): Promise<unknown> {
    if (this.closed) throw new Error("Package cache is closed");
    const pkg = this.packages.find(candidate => candidate.id === packageId);
    if (!pkg || !pkg.tools.some(tool => tool.name === toolName)) {
      throw new Error(`Unknown streamed tool: ${toolName}`);
    }

    const waitStart = performance.now();
    const entry = await this.enqueue(async () => {
      const resident = await this.ensureResident(pkg, "demand");
      resident.pinned++;
      resident.lastUsed = Date.now();
      if (resident.priority !== "foreground") {
        resident.priority = "foreground";
        this.trace("stream_prefetch_promoted", {
          package: pkg.id,
          reason: "demand",
        });
      }
      return resident;
    });

    const waitMs = performance.now() - waitStart;
    this.stats.foregroundWaits++;
    this.stats.totalForegroundWaitMs += waitMs;
    this.trace("stream_execution_wait", {
      package: pkg.id,
      tool: toolName,
      waitMs,
      kind: "foreground",
    });

    const callStart = performance.now();
    try {
      const result = await entry.worker.request(
        "call",
        { name: toolName, args, callId, cwd: this.cwd },
        this.options.callTimeoutMs,
        signal,
        onUpdate,
      );
      this.trace("stream_execution_complete", {
        package: pkg.id,
        tool: toolName,
        elapsedMs: performance.now() - callStart,
        pid: entry.worker.pid,
      });
      return result;
    } finally {
      await this.enqueue(async () => {
        entry.pinned = Math.max(0, entry.pinned - 1);
        entry.lastUsed = Date.now();
        entry.executions++;
        entry.priority = entry.selected ? "selected" : "speculative";
        await this.trimLocked(false);
      });
    }
  }

  private async trimLocked(expiredOnly: boolean): Promise<void> {
    for (const [packageId, entry] of [...this.residents]) {
      if (!entry.worker.alive) {
        await this.evict(packageId, "worker-exited");
      }
    }

    if (expiredOnly) {
      for (const entry of [...this.residents.values()]) {
        if (
          entry.pinned === 0 &&
          !entry.selected &&
          Date.now() - entry.lastUsed >= this.options.idleTtlMs
        ) {
          await this.evict(entry.packageId, "idle");
        }
      }
      return;
    }

    while (this.currentRssBytes() > this.options.residentBudgetMb * MB) {
      const victim = this.pickVictim("demand");
      if (!victim) {
        this.trace("stream_budget", {
          reason: "deferred; foreground workers are pinned",
          currentRssBytes: this.currentRssBytes(),
          residentBudgetBytes: this.options.residentBudgetMb * MB,
        });
        break;
      }
      await this.evict(victim.packageId, "budget");
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.closed = true;
    await this.enqueue(async () => {
      await Promise.all(
        [...this.residents.values()].map(entry => entry.worker.close()),
      );
      this.residents.clear();
      this.loading.clear();
      this.reserved.clear();
    });
  }
}
