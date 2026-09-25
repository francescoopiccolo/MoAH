import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiToolRouter } from "../src/router.js";
import { catalogForRouter, readOfficialCatalog } from "../src/official-catalog.js";
import { applySetupToConfig, codingModelArguments, type SetupSettings } from "../src/setup.js";
import { defaultConfig } from "../src/config.js";
import { buildCatalog } from "../src/catalog.js";
import { createMoahExtension } from "../src/pi-extension.js";
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
    const routerInput = JSON.parse(body.messages[1].content);
    assert.deepEqual(routerInput.alwaysAvailableTools, ["read", "write"]);
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

test("API router removes mutually conflicting selections", async () => {
  process.env.TEST_ROUTER_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ tools: ["rg", "grep"] }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const result = await new ApiToolRouter(routerConfig).route("search files", [
      { name: "rg", description: "Search with ripgrep", conflicts: ["grep"] },
      { name: "grep", description: "Search file contents" },
    ]);
    assert.deepEqual(result.selected, ["rg"]);
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

test("setup maps user choices onto the existing router configuration", () => {
  const settings: SetupSettings = {
    schema: 1,
    coding: { provider: "anthropic", model: "claude-sonnet-5", apiKeyEnv: "ANTHROPIC_API_KEY" },
    router: { provider: "openrouter", model: "openai/gpt-5.4-mini", sourceApiKeyEnv: "OPENROUTER_API_KEY" },
  };
  const config = applySetupToConfig(defaultConfig(), settings);
  assert.equal(config.router.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(config.router.model, "openai/gpt-5.4-mini");
  assert.equal(config.router.apiKeyEnv, "MOAH_ROUTER_API_KEY");
  assert.deepEqual(codingModelArguments(settings), ["--provider", "anthropic", "--model", "claude-sonnet-5"]);
});

test("unconfigured subagent is absent from every candidate path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moah-candidates-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "user");
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
  const tools = ["read", "bash", "powershell", "edit", "write", "subagent"].map(name => ({ name, description: name }));
  let active: string[] = [];
  const notifications: string[] = [];
  const ctx = { cwd: dir, mode: "tui", hasUI: true, ui: {
    setStatus() {},
    notify(message: string) { notifications.push(message); },
  } };
  const pi = {
    registerTool(tool: any) { tools.push(tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(name: string, handler: any) { handlers.set(name, handler); },
    getAllTools() { return tools; },
    getActiveTools() { return active; },
    setActiveTools(names: string[]) { active = names; },
  };

  try {
    await createMoahExtension({ cwd: dir, config: defaultConfig(), catalog: [], trace() {} })(pi);
    await handlers.get("session_start")!({}, ctx);
    await commands.get("moah")!.handler("", ctx);
    assert.equal(JSON.parse(notifications.at(-1)!).candidates.includes("subagent"), false);

    const agentDir = join(dir, "user", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "general.md"), "---\nname: general\ndescription: General helper\n---\nHelp.\n");
    await commands.get("moah")!.handler("", ctx);
    assert.equal(JSON.parse(notifications.at(-1)!).candidates.includes("subagent"), true);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test("MoAH loads its corrected rg wrapper while preserving the official source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moah-rg-catalog-"));
  try {
    const catalog = await buildCatalog(defaultConfig(), dir);
    const rg = catalog.find(pkg => pkg.corpusId === "truncated-tool");
    assert.equal(rg?.mode, "native");
    assert.match(rg!.entry, /truncated-tool\.ts$/);
    assert.match(rg!.nativeSource, /data[\\/]moah[\\/]rg\.ts$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rg wrapper handles spaces and rejects a missing pattern", {
  skip: spawnSync("rg", ["--version"], { stdio: "ignore" }).status !== 0,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "moah-rg-execution-"));
  try {
    const searchDir = join(dir, "folder with spaces");
    await mkdir(searchDir);
    await writeFile(join(searchDir, "marker.ts"), "// MOAH_ROUTER_MARKER_9173\n");
    const { default: registerRg } = await import("../data/moah/rg.ts");
    let rgTool: any;
    registerRg({ registerTool(tool: any) { rgTool = tool; } } as any);
    const result = await rgTool.execute("test", {
      pattern: "MOAH_ROUTER_MARKER_9173",
      path: "folder with spaces",
    }, undefined, undefined, { cwd: dir });
    assert.match(result.content[0].text, /marker\.ts:1:\/\/ MOAH_ROUTER_MARKER_9173/);
    assert.equal(result.details.matchCount, 1);
    await assert.rejects(() => rgTool.execute("test", {}, undefined, undefined, { cwd: dir }), /non-empty pattern/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
