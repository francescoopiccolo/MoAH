import type { ToolMetadata } from "../types.js";

export type PackageState =
  | "DISK"
  | "LOADING"
  | "RESIDENT_IDLE"
  | "RESIDENT_SELECTED"
  | "BUSY"
  | "EVICTING"
  | "FAILED";

export type LoadKind = "demand" | "speculative";

export interface PackageWorkerLoadRequest {
  entry: string;
  lazySdk: boolean;
}

export interface PackageWorkerCallRequest {
  name: string;
  args: unknown;
  callId: string;
  cwd: string;
}

export interface PackageWorkerLoadResult {
  tools: ToolMetadata[];
  rss: number;
  pid: number;
}

export interface PackageCacheStats {
  hits: number;
  misses: number;
  loads: number;
  loadFailures: number;
  evictions: number;
  foregroundWaits: number;
  totalLoadMs: number;
  totalForegroundWaitMs: number;
}

export interface PackageCacheEntrySnapshot {
  packageId: string;
  state: PackageState;
  pid?: number;
  rss: number;
  pinned: number;
  selected: boolean;
  priority: "foreground" | "selected" | "speculative";
  lastUsed: number;
  loads: number;
  hits: number;
  executions: number;
}

export interface PackageCacheSnapshot {
  entries: PackageCacheEntrySnapshot[];
  loading: string[];
  reserved: string[];
  stats: PackageCacheStats;
  budget: {
    maxProcesses: number;
    currentProcesses: number;
    residentBudgetBytes: number;
    estimatedRssBytes: number;
    currentRssBytes: number;
  };
}

export type StreamEventName =
  | "stream_prefetch_started"
  | "stream_prefetch_promoted"
  | "stream_load_started"
  | "stream_load_complete"
  | "stream_load_failed"
  | "stream_cache_hit"
  | "stream_cache_miss"
  | "stream_execution_wait"
  | "stream_execution_complete"
  | "stream_evict"
  | "stream_budget"
  | "stream_worker_exit"
  | "stream_native_fallback";
