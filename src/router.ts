import { performance } from "node:perf_hooks";
import type { Config, RouteResult, RouterUsage, ToolCandidate } from "./types.js";

const SYSTEM_PROMPT = [
  "You are a tool router for a coding agent.",
  "Select only tools that are likely needed for the next task.",
  "Return strict JSON: {\"tools\":[\"tool_name\"]}.",
  "Return an empty array when no optional tool is needed.",
  "Never explain, never invent tool names.",
].join("\n");

export class ApiToolRouter {
  constructor(private options: Config["router"]) {}

  async route(query: string, candidates: ToolCandidate[]): Promise<RouteResult> {
    const start = performance.now();
    if (!candidates.length) return { selected: [], ranked: [], elapsedMs: performance.now() - start };

    const apiKey = process.env[this.options.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing router API key: ${this.options.apiKeyEnv}`);

    const endpoint = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              request: query.slice(0, 4000),
              tools: candidates.map(tool => ({
                name: tool.name,
                description: tool.description.slice(0, 500),
              })),
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Router API ${response.status}: ${body.slice(0, 300)}`);
    }

    const payload = await response.json() as any;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Router API returned no text content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Router API returned invalid JSON");
    }

    const requested = (parsed as any)?.tools;
    if (!Array.isArray(requested) || requested.some(name => typeof name !== "string")) {
      throw new Error("Router API returned an invalid tools array");
    }

    const known = new Set(candidates.map(tool => tool.name));
    const selected = [...new Set(requested as string[])]
      .filter(name => known.has(name))
      .slice(0, this.options.maxTools);
    const selectedSet = new Set(selected);
    const ranked = candidates
      .map(tool => ({ name: tool.name, score: selectedSet.has(tool.name) ? 1 : 0 }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const rawUsage = payload?.usage;
    const usage: RouterUsage | undefined = rawUsage
      ? {
          inputTokens: Number(rawUsage.prompt_tokens ?? 0),
          outputTokens: Number(rawUsage.completion_tokens ?? 0),
          totalTokens: Number(rawUsage.total_tokens ?? 0),
          ...(rawUsage.prompt_tokens_details?.cached_tokens !== undefined
            ? { cacheReadTokens: Number(rawUsage.prompt_tokens_details.cached_tokens) }
            : {}),
          ...(rawUsage.cost !== undefined
            ? { cost: Number(rawUsage.cost) }
            : {}),
        }
      : undefined;

    return {
      selected,
      ranked,
      elapsedMs: performance.now() - start,
      ...(usage ? { usage } : {}),
      ...(typeof payload?.model === "string" ? { model: payload.model } : {}),
    };
  }
}
