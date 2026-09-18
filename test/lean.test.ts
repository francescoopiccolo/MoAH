import assert from "node:assert/strict";
import test from "node:test";
import { ApiToolRouter } from "../src/router.js";
import { catalogForRouter, readOfficialCatalog } from "../src/official-catalog.js";
import type { Config } from "../src/types.js";

const routerConfig: Config["router"] = {
  enabled: true,
  mode: "auto",
  baseUrl: "https://router.example/v1",
  model: "router-mini",
  apiKeyEnv: "TEST_ROUTER_KEY",
  maxTools: 2,
  baseTools: ["read", "write"],
};

test("API router parses a valid JSON selection", async () => {
  process.env.TEST_ROUTER_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://router.example/v1/chat/completions");
    const body = JSON.parse(String((init as RequestInit).body));
    assert.equal(body.model, "router-mini");
    return new Response(JSON.stringify({
      model: "router-mini",
      usage: {
        prompt_tokens: 120,
        completion_tokens: 8,
        total_tokens: 128,
        prompt_tokens_details: { cached_tokens: 12 },
      },
      choices: [{ message: { content: JSON.stringify({ tools: ["todo", "question", "not-real"] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await new ApiToolRouter(routerConfig).route("make a checklist", [
      { name: "todo", description: "Track tasks" },
      { name: "question", description: "Ask one question" },
      { name: "write", description: "Write files" },
    ]);
    assert.deepEqual(result.selected, ["todo", "question"]);
    assert.equal(result.model, "router-mini");
    assert.deepEqual(result.usage, {
      inputTokens: 120,
      outputTokens: 8,
      totalTokens: 128,
      cacheReadTokens: 12,
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_ROUTER_KEY;
  }
});

test("official catalog is complete and derives a full router candidate set", async () => {
  const catalog = await readOfficialCatalog();
  assert.equal(catalog.capabilities.length, 31);
  const candidates = catalogForRouter(catalog, ["read", "bash", "powershell", "edit", "write"]);
  assert.deepEqual(candidates.map(candidate => candidate.name), [
    "grep",
    "find",
    "ls",
    "subagent",
    "todo",
    "question",
    "questionnaire",
    "structured_output",
    "rg",
    "reload_runtime",
  ]);
});
