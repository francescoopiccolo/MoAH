export interface ToolCandidate {
  name: string;
  description: string;
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
}

export interface IndexedPackage {
  id: string;
  corpusId?: string;
  entry: string;
  root: string;
  nativeSource: string;
  mode: "native" | "unavailable";
  provenance: NonNullable<PackageSpec["provenance"]>;
  autoAcquire: boolean;
  nativeResident: boolean;
  routerEligible: boolean;
  sourceHash?: string;
  sourceCommit?: string;
  reason: string;
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
  packages: PackageSpec[];
}

export type Trace = (event: string, details: Record<string, unknown>) => void;
