import { RunTree, isTracingEnabled } from "langsmith";
import type { RouterUsage } from "./types.js";

export interface MoahTraceMetadata {
  condition: string;
  configHash: string;
  mainModel?: string;
  routerModel: string;
  sessionId: string;
}

export class MoahTracer {
  private root?: RunTree;
  private enabled: boolean;

  constructor(private metadata: MoahTraceMetadata) {
    this.enabled = isTracingEnabled();
    if (this.enabled) {
      this.root = new RunTree({
        name: "moah-session",
        run_type: "chain",
        inputs: { condition: this.metadata.condition },
        metadata: this.metadata as unknown as Record<string, unknown>,
        tags: ["moah", this.metadata.condition],
      });
    }
  }

  child(name: string, runType: string, inputs: Record<string, unknown>, metadata?: Record<string, unknown>): RunTree | undefined {
    return this.root?.createChild({
      name,
      run_type: runType,
      inputs,
      ...(metadata ? { metadata } : {}),
    });
  }

  async endChild(run: RunTree | undefined, outputs?: Record<string, unknown>, error?: string): Promise<void> {
    if (!run) return;
    await run.end(outputs, error);
  }

  async end(outputs?: Record<string, unknown>): Promise<void> {
    if (!this.root) return;
    await this.root.end(outputs);
    await this.root.postRun(false);
  }

  async flush(): Promise<void> {
    if (!this.enabled) return;
    await RunTree.getSharedClient().awaitPendingTraceBatches?.();
  }
}

export function usageToMetadata(usage?: RouterUsage): Record<string, number> | undefined {
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    ...(usage.cacheReadTokens !== undefined ? { cache_read_tokens: usage.cacheReadTokens } : {}),
  };
}
