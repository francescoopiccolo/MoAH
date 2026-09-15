import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { buildCatalog } from "../src/catalog.js";
import { createMoahExtension } from "../src/pi-extension.js";
import { ToolRouter } from "../src/router.js";
import { CATALOG_MESSAGE } from "../src/capabilities.js";
import type { Config } from "../src/types.js";
import { fixtureConfig, temporaryDirectory } from "./helpers.js";
import { syncPublicCatalog } from "../src/public-catalog.js";

type Call = { name: string; args: unknown };
const activate = (...names: string[]): Call => ({ name: "moah_activate", args: { tools: names } });
const search: Call = { name: "search_remote", args: {} };
const discover = (query = "", offset = 0): Call => ({ name: "moah_discover", args: { query, offset } });
const names = (request: any): string[] => (request.tools ?? []).map((t: any) => t.function.name);
const content = (request: any) => JSON.stringify(request.messages);
const schema = (request: any) => JSON.stringify(request.tools);
const system = (request: any) => JSON.stringify(request.messages.filter((m: any) => m.role === "system" || m.role === "developer"));

async function scenario(steps: (Call | Call[] | null)[], options: {
  configure?: (c: Config) => void;
  excludeTools?: string[];
  noTools?: "all";
  extra?: ExtensionFactory[];
  nativePaths?: string[];
  prompts?: string[];
  publicPackages?: boolean;
} = {}) {
  const tmp = await temporaryDirectory();
  const config = await fixtureConfig();
  config.router.enabled = false;
  config.selection.maxActiveTools = 2;
  options.configure?.(config);
  const requests: any[] = [];
  const errors: unknown[] = [];
  const events: { event: string; data: Record<string, any> }[] = [];
  let embeddingCalls = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const step = steps[requests.length - 1];
    const calls = step ? (Array.isArray(step) ? step : [step]) : [];
    const delta = calls.length ? { role: "assistant", tool_calls: calls.map((c, index) => ({
      index, id: `call_${requests.length}_${index}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) },
    })) } : { role: "assistant", content: "Completed using the original Pi loop." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" }]) {
      res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [choice] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    if (options.publicPackages) await syncPublicCatalog(tmp.path, () => {}, async () => '1-1 / 1<article data-package-name="public-fixture" data-package-types="extension"><p class="packages-desc">Public-only search capability</p><a href="/?package-version=1.0.0">report</a></article>');
    const catalog = await buildCatalog(config, tmp.path);
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const runtime = await ModelRuntime.create({ authPath: join(tmp.path, "auth.json"), modelsPath: null, modelsStorePath: join(tmp.path, "models"), refreshOnCreate: false, allowModelNetwork: false });
    runtime.registerProvider("moah-test", {
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, api: "openai-completions", apiKey: "test-only",
      models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    const router = new ToolRouter({
      async embed() { embeddingCalls++; throw new Error("Test semantic model unavailable"); },
      async dispose() {},
    }, config.router);
    const loader = new DefaultResourceLoader({ cwd: tmp.path, agentDir: tmp.path, settingsManager: settings,
      additionalExtensionPaths: [...catalog.filter(p => p.mode === "native").map(p => p.nativeSource), ...options.nativePaths ?? []],
      additionalSkillPaths: catalog.filter(p => p.mode === "stream").flatMap(p => p.resources.skills),
      additionalPromptTemplatePaths: catalog.filter(p => p.mode === "stream").flatMap(p => p.resources.prompts),
      additionalThemePaths: catalog.filter(p => p.mode === "stream").flatMap(p => p.resources.themes),
      noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
      extensionFactories: [createMoahExtension({ cwd: tmp.path, config, catalog, router, trace: (event, data) => events.push({ event, data }) }), ...options.extra ?? []],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await createAgentSession({ cwd: tmp.path, agentDir: tmp.path, modelRuntime: runtime,
      model: runtime.getModel("moah-test", "fixture"), thinkingLevel: "off", resourceLoader: loader,
      settingsManager: settings, sessionManager: SessionManager.inMemory(tmp.path), excludeTools: options.excludeTools, noTools: options.noTools,
    }));
    await session.bindExtensions({ mode: "print", onError: e => errors.push(e) });
    for (const prompt of options.prompts ?? ["Plan the change, research it, then implement."]) await session.prompt(prompt);
    assert.deepEqual(errors, []);
    assert.equal(requests.length, steps.length);
    const messages = [...session.messages];
    return { requests, events, messages, embeddingCalls, indexed: catalog };
  } finally {
    await session?.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
    session?.dispose();
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    await tmp.cleanup();
  }
}

test("Pi: public packages are discoverable offline but never activatable as installed tools", { timeout: 30000 }, async () => {
  const result = await scenario([{ name: "moah_discover", args: { query: "public-fixture", scope: "public" } }, activate("public-fixture"), null], { publicPackages: true });
  assert.ok(!content(result.requests[0]).includes("Public-only search capability"), "public descriptions must not fill the initial context");
  assert.ok(content(result.requests[1]).includes("npm:public-fixture@1.0.0"));
  assert.ok(content(result.requests[2]).includes("Unknown or unavailable tools"));
  assert.ok(result.requests.every(r => !names(r).includes("public-fixture")));
  assert.equal(result.events.filter(e => e.event === "load").length, 0);
});

test("Pi: model selects phases; old schemas/guidelines and processes are removed, plan output survives", { timeout: 90000 }, async () => {
  const result = await scenario([activate("plan_task"), { name: "plan_task", args: {} }, activate("search_remote"), search, activate(), null], {
    configure(c) { c.packages.push({ id: "plan-fixture", entry: resolve("test/fixtures/plan/index.mjs"), stateless: true }); },
  });
  const r = result.requests;
  assert.ok(content(r[0]).includes("Create a plan before implementing"));
  assert.ok(!schema(r[0]).includes("planning_only_parameter"));
  assert.ok(names(r[1]).includes("plan_task"));
  assert.ok(schema(r[1]).includes("planning_only_parameter"));
  assert.ok(system(r[1]).includes("PLAN_ONLY_GUIDELINE"));
  assert.ok(!names(r[3]).includes("plan_task"));
  assert.ok(!schema(r[3]).includes("planning_only_parameter"));
  assert.ok(!system(r[3]).includes("PLAN_ONLY_GUIDELINE"));
  assert.ok(content(r[3]).includes("PLAN_RESULT"));
  assert.ok(names(r[3]).includes("search_remote"));
  assert.ok(!names(r[5]).includes("search_remote"));
  assert.ok(names(r[5]).includes("read"));
  assert.equal(result.embeddingCalls, 0, "main-model routing must not call an embedding model");
  for (const request of r) assert.equal(content(request).split("MoAH capability catalog (runtime snapshot").length - 1, 1);
  for (const request of r) {
    const snapshot = request.messages.findIndex((m: any) => JSON.stringify(m).includes("MoAH capability catalog (runtime snapshot"));
    const user = request.messages.findIndex((m: any) => JSON.stringify(m).includes("Plan the change, research it, then implement."));
    assert.ok(snapshot <= user, "catalog must precede or be merged before the actual user request");
    assert.ok(!JSON.stringify(request.messages.at(-1)).includes("MoAH capability catalog"), "after tool work the catalog must not replace the last tool result");
  }
  assert.ok(!result.messages.some(m => m.role === "custom" && m.customType === CATALOG_MESSAGE), "catalog must not persist");
  const evictions = result.events.filter(e => e.event === "evict" && e.data.reason === "deselected");
  assert.ok(evictions.some(e => e.data.package === "plan-fixture"));
  assert.ok(evictions.some(e => e.data.package === "fixture"));
  for (const eviction of evictions) assert.throws(() => process.kill(eviction.data.pid, 0));
});

test("Pi: repeated unchanged activation pauses routing until real tool work or a new prompt", { timeout: 60000 }, async () => {
  const r = await scenario([activate(), activate(), { name: "read", args: { path: resolve("test/fixtures/tools.mjs") } }, activate("search_remote"), search, null, null], {
    prompts: ["Read a file, then search", "Next request"],
  });
  assert.ok(content(r.requests[1]).includes("No change"));
  assert.ok(!names(r.requests[2]).includes("moah_activate"));
  assert.ok(names(r.requests[2]).includes("read"));
  assert.ok(names(r.requests[3]).includes("moah_activate"));
  assert.ok(names(r.requests[4]).includes("search_remote"));
  assert.ok(names(r.requests[6]).includes("moah_activate"));
  assert.equal(r.events.filter(e => e.event === "activation_requested").length, 1);
});

test("Pi: duplicate discovery pauses only discovery, distinct pages remain usable", { timeout: 60000 }, async () => {
  const r = await scenario([discover(), discover("", 1), discover(), activate("search_remote"), search, null], {
    configure(c) { c.selection.catalogPageSize = 1; },
  });
  assert.ok(names(r.requests[2]).includes("moah_discover"));
  assert.ok(!names(r.requests[3]).includes("moah_discover"));
  assert.ok(names(r.requests[3]).includes("moah_activate"));
  assert.ok(names(r.requests[5]).includes("moah_discover"));
});

test("Pi: equivalent empty searches and invalid activations cannot evade the repeat guard", { timeout: 60000 }, async () => {
  const r = await scenario([discover("zzzzzz-absent"), discover("qqqqqq-absent"), activate("missing"), activate("tool:missing"), null]);
  assert.ok(!names(r.requests[2]).includes("moah_discover"));
  assert.ok(!names(r.requests[4]).includes("moah_activate"));
  assert.ok(names(r.requests[4]).includes("read"));
});

test("Pi: discovery browses pages without activating or loading code", { timeout: 60000 }, async () => {
  const r = await scenario([discover(), discover("", 1), discover("inspect_db"), null], { configure(c) { c.selection.catalogPageSize = 1; } });
  assert.ok(!r.events.some(e => e.event === "load"));
  assert.ok(!r.requests.some(q => names(q).includes("inspect_db") || names(q).includes("search_remote")));
  assert.ok(content(r.requests[1]).includes("nextOffset"));
  assert.ok(r.events.some(e => e.event === "discover" && e.data.offset === 1));
});

test("Pi: semantic discovery failure stays lexical, never enables the entire catalog", { timeout: 60000 }, async () => {
  const r = await scenario([discover("database schema"), activate("inspect_db"), null], { configure(c) { c.router.enabled = true; } });
  assert.ok(r.embeddingCalls > 0);
  assert.ok(r.events.some(e => e.event === "discovery_fallback"));
  assert.ok(!names(r.requests[1]).includes("inspect_db"));
  assert.ok(names(r.requests[2]).includes("inspect_db"));
  assert.ok(!names(r.requests[2]).includes("search_remote"));
});

test("Pi: unknown or over-budget selections leave the current phase intact", { timeout: 60000 }, async () => {
  const r = await scenario([activate("search_remote"), activate("missing_tool"), activate("search_remote", "inspect_db"), null], {
    configure(c) { c.selection.maxActiveTools = 1; },
  });
  for (const request of r.requests.slice(1)) {
    assert.ok(names(request).includes("search_remote"));
    assert.ok(!names(request).includes("inspect_db"));
  }
  assert.ok(content(r.requests[2]).includes("Unknown or unavailable"));
  assert.ok(content(r.requests[3]).includes("at most 1"));
});

test("Pi: excluded tools stay absent from catalog and cannot be activated", { timeout: 60000 }, async () => {
  const r = await scenario([activate("inspect_db"), null], { excludeTools: ["inspect_db"] });
  assert.ok(!content(r.requests[0]).includes("inspect_db"));
  assert.ok(!r.requests.some(q => names(q).includes("inspect_db")));
  assert.ok(!r.events.some(e => e.event === "load"));
});

test("Pi: --no-tools also suppresses controls and transient catalog", { timeout: 60000 }, async () => {
  const r = await scenario([null], { noTools: "all" });
  assert.deepEqual(names(r.requests[0]), []);
  assert.ok(!content(r.requests[0]).includes("MoAH capability catalog"));
  assert.ok(!r.events.some(e => e.event === "load"));
});

test("Pi: new user requests reset the optional set without losing prior output", { timeout: 60000 }, async () => {
  const r = await scenario([activate("search_remote"), search, null, null], { prompts: ["Research this change", "Now implement the code"] });
  assert.ok(names(r.requests[2]).includes("search_remote"));
  assert.ok(!names(r.requests[3]).includes("search_remote"));
  assert.ok(content(r.requests[3]).includes("remote-ok"));
});

test("Pi: explicit continuity setting preserves selection across prompts", { timeout: 60000 }, async () => {
  const r = await scenario([activate("search_remote"), null, null], {
    prompts: ["Research", "Continue researching"], configure(c) { c.selection.resetOnPrompt = false; },
  });
  assert.ok(names(r.requests[2]).includes("search_remote"));
});

test("Pi: external mode restriction remains authoritative across requests", { timeout: 60000 }, async () => {
  const r = await scenario([null, null], { prompts: ["First request", "Next request"], extra: [pi => {
    pi.on("before_agent_start", () => { pi.setActiveTools(["read"]); });
  }] });
  for (const request of r.requests) assert.deepEqual(names(request), ["read"]);
});

test("Pi: activation is committed after the whole current tool batch", { timeout: 60000 }, async () => {
  const r = await scenario([activate("search_remote"), [activate("inspect_db"), search], null]);
  assert.ok(names(r.requests[1]).includes("search_remote"));
  assert.ok(names(r.requests[2]).includes("inspect_db"));
  assert.ok(!names(r.requests[2]).includes("search_remote"));
  assert.ok(content(r.requests[2]).includes("remote-ok"));
});

test("Pi: dense exposes all tools; switching back to sparse resets the phase", { timeout: 60000 }, async () => {
  const r = await scenario([null, null], { prompts: ["/moah dense", "First request", "/moah sparse", "Second request"] });
  assert.ok(names(r.requests[0]).includes("search_remote") && names(r.requests[0]).includes("inspect_db"));
  assert.ok(!content(r.requests[0]).includes("MoAH capability catalog"));
  assert.ok(!names(r.requests[1]).includes("search_remote") && !names(r.requests[1]).includes("inspect_db"));
  assert.ok(content(r.requests[1]).includes("MoAH capability catalog"));
});

const nativeCall: Call = { name: "native_counter", args: {} };
function withNative(c: Config, dynamic = false) {
  c.packages.push({ id: "native-fixture", entry: resolve("test/fixtures/native-package/index.mjs"), stateless: true,
    context: dynamic ? "dynamic" : "preserve" });
}

test("Pi: incompatible worker falls back to native with hooks, commands, skills and prompts intact", { timeout: 90000 }, async () => {
  const r = await scenario([nativeCall, activate(), nativeCall, discover(), null, nativeCall, null], {
    configure: c => withNative(c), prompts: ["Inspect the native package", "/native-counter", "Read the counter again"],
  });
  const pkg = r.indexed.find(p => p.id === "native-fixture")!;
  assert.equal(pkg.mode, "native");
  assert.match(pkg.reason, /fallback/);
  assert.ok(pkg.resources.skills.length > 0 && pkg.resources.prompts.length > 0);
  assert.ok(content(r.requests[1]).includes("native-count=1; starts=1; session=true"));
  assert.ok(content(r.requests[3]).includes("native-count=2; starts=1"));
  assert.ok(content(r.requests[6]).includes("native-count=4; starts=1"));
  for (const request of r.requests) assert.ok(names(request).includes("native_counter"), "preserve policy keeps native tool exposure intact");
  assert.ok(content(r.requests[4]).includes("fixture-guide"));
  assert.ok(content(r.requests[4]).includes("fixture-review"));
  assert.ok(content(r.requests[4]).includes("/native-counter"));
  assert.ok(!r.events.some(e => e.event === "load" && e.data.package === "native-fixture"));
});

test("Pi: opted-in native schema can be hidden without losing session state", { timeout: 90000 }, async () => {
  const r = await scenario([activate("tool:native_counter"), nativeCall, activate(), activate("native_counter"), nativeCall, null], {
    configure: c => withNative(c, true),
  });
  assert.ok(!names(r.requests[0]).includes("native_counter"));
  assert.ok(names(r.requests[1]).includes("native_counter"));
  assert.ok(!names(r.requests[3]).includes("native_counter"));
  assert.ok(names(r.requests[4]).includes("native_counter"));
  assert.ok(content(r.requests[5]).includes("native-count=2; starts=1; session=true"));
  assert.ok(!r.events.some(e => e.event === "load"));
});

test("Pi: missing packages remain visible as unavailable without blocking working tools", { timeout: 60000 }, async () => {
  const r = await scenario([discover("missing-package"), activate("search_remote"), search, null], {
    configure(c) { c.packages.push({ id: "missing-package", entry: "nonexistent-package/index.mjs", mode: "native" }); },
  });
  assert.equal(r.indexed.find(p => p.id === "missing-package")!.mode, "unavailable");
  assert.ok(content(r.requests[1]).includes("unavailable"));
  assert.ok(content(r.requests[3]).includes("remote-ok"));
});

test("Pi: a package already loaded natively is reused without duplicate workers", { timeout: 60000 }, async () => {
  const r = await scenario([activate("search_remote"), search, null], { nativePaths: [resolve("test/fixtures/tools.mjs")] });
  assert.ok(content(r.requests[2]).includes("remote-ok"));
  assert.ok(!r.events.some(e => e.event === "load"));
});
