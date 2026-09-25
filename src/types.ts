export interface ToolCandidate {
  name: string;
  description: string;
  /** Other optional tools that should not be selected in the same route. */
  conflicts?: string[];
}

export interface ScoredTool {
  name: string;
  score: number;
}

export interface RouterUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

export interface RouteResult {
  selected: string[];
  ranked: ScoredTool[];
  elapsedMs: number;
  usage?: RouterUsage;
  model?: string;
}

export interface ToolMetadata {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  promptSnippet?: string;
  promptGuidelines?: string[];
  executionMode?: "parallel" | "sequential";
  constrainedSampling?: unknown;
  customRendering?: boolean;
}

export type StreamingClass =
  | "EXACT_STREAMABLE"
  | "EXECUTION_STREAMABLE_WITH_GENERIC_RENDERING"
  | "CONTEXT_ADAPTER_STREAMABLE"
  | "NATIVE_REQUIRED";

export interface PackageSpec {
  id: string;
  package?: string;
  version?: string;
  entry: string;
  provenance?: "pi-official-example" | "community-installed";
  /** Loaded natively by Pi when MoAH starts. */
  nativeResident?: boolean;
  /** Visible to the API router when the package is loaded by Pi. */
  routerEligible?: boolean;
  sourceCommit?: string;
  sourceHash?: string;
  sourcePath?: string;
  corpusId?: string;
  /**
   * Native is the fallback whenever the streaming contract cannot be
   * established. "stream" requires a successful isolated worker probe.
   */
  mode?: "auto" | "native" | "stream";
  /** Explicit opt-in required before a package may be hosted in a worker. */
  stateless?: boolean;
  /** Lazy uses a tiny Pi SDK compatibility facade to keep worker RSS small. */
  workerSdk?: "full" | "lazy";
}

export interface IndexedPackage {
  id: string;
  corpusId?: string;
  entry: string;
  root: string;
  nativeSource: string;
  mode: "native" | "stream" | "unavailable";
  provenance: NonNullable<PackageSpec["provenance"]>;
  autoAcquire: boolean;
  nativeResident: boolean;
  routerEligible: boolean;
  tools: ToolMetadata[];
  workerSdk: "full" | "lazy";
  sourceFingerprint?: string;
  streamingClass?: StreamingClass;
  sourceHash?: string;
  sourceCommit?: string;
  reason: string;
}

export interface StreamingConfig {
  /** Disable worker residency and keep eligible packages native. */
  enabled: boolean;
  /** Start router-selected package loads without blocking the main path. */
  prefetch: boolean;
  /** Cold mode disables popularity preload and speculative prefetch. */
  cold: boolean;
  /** Number of hottest streamable packages to warm at session start. */
  hotPreload: number;
  maxProcesses: number;
  residentBudgetMb: number;
  idleTtlMs: number;
  loadTimeoutMs: number;
  callTimeoutMs: number;
  /** Conservative per-worker estimate used before the first RSS sample. */
  estimatedRssMb: number;
}

export interface Config {
  baseline: {
    enabled: boolean;
  };
  router: {
    enabled: boolean;
    mode: "auto" | "suggest" | "oracle";
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
    maxTools: number;
    baseTools: string[];
  };
  streaming: StreamingConfig;
  packages: PackageSpec[];
}

export type Trace = (event: string, details: Record<string, unknown>) => void;
