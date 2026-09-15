import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Config, Embedder, ToolCandidate, RouteResult, ScoredTool } from "./types.js";
import { writeJson } from "./config.js";

export class LocalEmbedder implements Embedder {
  private extractor: any;
  constructor(private options: Config["router"], private cacheDir: string, private download = false) {}
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    if (!this.extractor) {
      const { pipeline } = await import("@huggingface/transformers");
      this.extractor = await pipeline("feature-extraction", this.options.model, {
        cache_dir: this.cacheDir,
        local_files_only: !this.download,
        device: this.options.device,
        dtype: this.options.dtype,
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      });
    }
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 8) {
      const tensor = await this.extractor(texts.slice(i, i + 8), { pooling: "mean", normalize: true, truncation: true });
      vectors.push(...tensor.tolist());
      tensor.dispose?.();
    }
    return vectors;
  }
  async dispose(): Promise<void> { await this.extractor?.dispose(); this.extractor = undefined; }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) throw new Error("Invalid embedding dimensions");
  let sum = 0, an = 0, bn = 0;
  for (let i = 0; i < a.length; i++) { sum += a[i] * b[i]; an += a[i] ** 2; bn += b[i] ** 2; }
  const score = sum / Math.sqrt(an * bn);
  if (!Number.isFinite(score)) throw new Error("Invalid embedding values");
  return score;
}

export class ToolRouter {
  private embeddings = new Map<string, number[]>();
  private previous = new Set<string>();
  constructor(private embedder: Embedder, private options: Config["router"], private cacheDir?: string) {}
  reset(): void { this.previous.clear(); }
  async route(query: string, candidates: ToolCandidate[]): Promise<RouteResult> {
    const start = performance.now();
    const names = new Set(candidates.map(t => t.name));
    if (names.size !== candidates.length) throw new Error("Duplicate candidate tool names");
    const texts = candidates.map(t => `${t.name}: ${t.description}`.slice(0, 2000));
    const key = createHash("sha256").update(JSON.stringify(["e5-prefix-v1", this.options.model, this.options.dtype, this.options.device, texts])).digest("hex");
    const cacheFile = this.cacheDir ? join(this.cacheDir, `${key}.json`) : undefined;
    if (texts.some(t => !this.embeddings.has(t))) {
      let values: number[][] | undefined;
      if (cacheFile) {
        try {
          const disk = JSON.parse(await readFile(cacheFile, "utf8"));
          if (Array.isArray(disk) && disk.length === texts.length && disk.every(v => Array.isArray(v) && v.length && v.every(Number.isFinite)) && disk.every(v => v.length === disk[0].length)) values = disk;
        } catch { /* Cache is optional; rebuild corrupt/missing data. */ }
      }
      values ??= await this.embedder.embed(texts.map(t => this.options.model.includes("e5") ? `passage: ${t}` : t));
      if (values.length !== texts.length) throw new Error("Embedding count mismatch");
      for (let i = 0; i < texts.length; i++) this.embeddings.set(texts[i], values[i]);
      if (cacheFile) await writeJson(cacheFile, values);
    }
    if (!candidates.length) return { selected: [], ranked: [], elapsedMs: performance.now() - start };
    const queryText = query.slice(0, this.options.maxQueryCharacters) || "available tools";
    const [q] = await this.embedder.embed([this.options.model.includes("e5") ? `query: ${queryText}` : queryText]);
    const ranked: ScoredTool[] = candidates.map((t, i) => ({ name: t.name, score: cosine(q, this.embeddings.get(texts[i])!) }));
    ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const pinned = this.options.pinnedTools.filter(n => names.has(n));
    const optional = ranked.filter(t => !pinned.includes(t.name));
    optional.sort((a, b) => (b.score + (this.previous.has(b.name) ? this.options.keepMargin : 0)) -
      (a.score + (this.previous.has(a.name) ? this.options.keepMargin : 0)) || a.name.localeCompare(b.name));
    const selected = [...pinned, ...optional.filter(t => t.score >= this.options.minimumScore).slice(0, this.options.topK).map(t => t.name)];
    // Scores are similarities, not probabilities. A no-match keeps only pinned tools;
    // the always-available discovery tool can recover capabilities explicitly.
    this.previous = new Set(selected);
    return { selected, ranked, elapsedMs: performance.now() - start };
  }
  async dispose(): Promise<void> { await this.embedder.dispose(); this.embeddings.clear(); }
}
