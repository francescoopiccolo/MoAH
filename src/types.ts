export interface ToolMetadata {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  executionMode?: "parallel" | "sequential";
  constrainedSampling?: unknown;
  customRendering?: boolean;
}

export interface PackageSpec {
  id: string;
  package?: string;
  version?: string;
  entry: string;
  // Native is the fallback whenever the streaming contract cannot be established.
  mode?: "auto" | "native" | "stream";
  context?: "preserve" | "dynamic";
  stateless?: boolean;
  workerSdk?: "full" | "lazy";
}
export interface IndexedPackage {
  id: string;
  entry: string;
  root: string;
  fingerprint: string;
  tools: ToolMetadata[];
  workerSdk?: "full" | "lazy";
  mode: "native" | "stream" | "unavailable";
  reason: string;
  nativeSource: string;
  context: "preserve" | "dynamic";
  resources: { extensions: string[]; skills: string[]; prompts: string[]; themes: string[] };
}
export interface Capability {
  id: string;
  name: string;
  description: string;
  kind: "tool" | "command" | "skill" | "prompt" | "package" | "theme";
  execution: "core" | "native" | "stream";
  availability: "available" | "inactive" | "unavailable" | "unknown";
  activation: "tool" | "pi-command" | "read-skill" | "native";
  source: string;
  action?: string;
  packageId?: string;
  prerequisites: "managed-by-pi" | "unknown";
}
export interface Config {
  selection: {
    maxActiveTools: number;
    catalogPageSize: number;
    descriptionCharacters: number;
    resetOnPrompt: boolean;
    releaseInactive: boolean;
  };
  router: {
    enabled: boolean;
    model: string;
    device: "cpu" | "dml" | "cuda";
    dtype: "q8" | "fp32";
    topK: number;
    minimumScore: number;
    keepMargin: number;
    pinnedTools: string[];
    maxQueryCharacters: number;
  };
  cache: {
    maxProcesses: number;
    residentBudgetMb: number;
    idleTtlMs: number;
    loadTimeoutMs: number;
    callTimeoutMs: number;
  };
  packages: PackageSpec[];
}
export interface ToolCandidate { name: string; description: string; parameters?: unknown }
export interface ScoredTool { name: string; score: number }
export interface RouteResult { selected: string[]; ranked: ScoredTool[]; elapsedMs: number }
export interface Embedder { embed(texts: string[]): Promise<number[][]>; dispose(): Promise<void> }
export type Trace = (event: string, details: Record<string, unknown>) => void;
