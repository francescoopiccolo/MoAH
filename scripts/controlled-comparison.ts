import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { runBenchmark } from "../src/benchmark.js";
import { buildCatalog, readCatalog, resolvePackage } from "../src/catalog.js";
import { readPublicCatalog } from "../src/public-catalog.js";
import { readConfig, stateDir, writeJson } from "../src/config.js";

// Scripted provider: measures harness behavior, never model quality or paid tokens.
const cwd = process.cwd();
const tailArg = process.argv.indexOf("--tail-steps");
const tailSteps = tailArg < 0 ? 0 : Number(process.argv[tailArg + 1]);
if (!Number.isInteger(tailSteps) || tailSteps < 0 || tailSteps > 64) throw new Error("tail-steps must be an integer from 0 to 64");
const configArg = process.argv.indexOf("--config");
const config = await readConfig(configArg < 0 ? undefined : resolve(cwd, process.argv[configArg + 1]));
const root = join(stateDir(cwd), "controlled-runs");
await mkdir(root, { recursive: true });
const workspace = await mkdtemp(join(root, "run-"));
const catalog = configArg < 0 ? await readCatalog(config, cwd) : await buildCatalog({ ...config, packages: await Promise.all(config.packages.map(async p => ({ ...p, package: undefined, version: undefined, entry: (await resolvePackage(p, cwd)).entry }))) }, workspace);
const publicCatalog = await readPublicCatalog(cwd);
if (publicCatalog) await writeJson(join(stateDir(workspace), "public-catalog.json"), publicCatalog);
const agentDir = join(workspace, "agent-config");
const groups: { requests: { schemaBytes: number; inputBytes: number; schemaHash: string; names: string[] }[] }[] = [];
const oldAgent = process.env.PI_CODING_AGENT_DIR;
const oldOffline = process.env.PI_OFFLINE;
const server = createServer(async (req, res) => {
  try {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (!body.messages.some((m: any) => m.role === "assistant")) groups.push({ requests: [] });
    const names: string[] = (body.tools ?? []).map((t: any) => t.function.name);
    const schemas = JSON.stringify(body.tools ?? []);
    groups.at(-1)!.requests.push({ schemaBytes: Buffer.byteLength(schemas), inputBytes: Buffer.byteLength(JSON.stringify({ messages: body.messages, tools: body.tools })),
      schemaHash: createHash("sha256").update(schemas).digest("hex"), names });
    const results = body.messages.filter((m: any) => m.role === "tool");
    const done = (id: string) => results.some((m: any) => m.tool_call_id === id);
    const useWeb = JSON.stringify(body.messages).includes("CONTROLLED_USE_WEB");
    let call: { id: string; name: string; args: unknown } | undefined;
    if (useWeb && !done("fetch")) {
      call = names.includes("webfetch")
        ? { id: "fetch", name: "webfetch", args: { url: "https://example.com/", max_chars: 2000, offset: 0 } }
        : { id: "activate", name: "moah_activate", args: { tools: ["webfetch"] } };
    } else if (!done("write")) {
      const fetched = !useWeb || JSON.stringify(results.find((m: any) => m.tool_call_id === "fetch")).includes("Example Domain");
      call = { id: "write", name: "write", args: { path: "result.mjs", content: `export const answer = ${fetched ? 42 : 0};\n` } };
    } else if (useWeb && names.includes("moah_activate") && names.includes("webfetch")) {
      call = { id: "release", name: "moah_activate", args: { tools: [] } };
    } else if (tailSteps) {
      for (let step = 1; step <= tailSteps; step++) if (!done(`step_${step}`)) {
        call = { id: `step_${step}`, name: "write", args: { path: `steps/step_${step}.txt`, content: `step ${step}` } }; break;
      }
    }
    assert.ok(!call || names.includes(call.name), "script must obey the active tool schemas");
    // Identical final dwell permits post-eviction sampling; these times are not LLM latency.
    await new Promise(r => setTimeout(r, call ? 200 : 1200));
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: "Controlled sequence completed." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }])
      res.write(`data: ${JSON.stringify({ id: "controlled", model: "fixture", object: "chat.completion.chunk", created: 1, choices: [choice] })}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch { res.writeHead(500); res.end("Controlled provider failed"); }
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
try {
  const port = (server.address() as { port: number }).port;
  await writeJson(join(agentDir, "models.json"), { providers: { "controlled-local": {
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test-only", api: "openai-completions",
    models: [{ id: "fixture", name: "Scripted provider", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } });
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
  config.packages = catalog.map(p => ({ id: p.id, entry: p.entry, mode: p.mode as "native" | "stream", context: p.context, stateless: p.mode === "stream", workerSdk: p.workerSdk }));
  assert.ok(catalog.some(p => p.tools.some(t => t.name === "webfetch")), "This experiment requires the actual web package");
  await writeJson(join(workspace, "moah.config.json"), config);
  await buildCatalog(config, workspace);
  const verify = "import assert from 'node:assert/strict'; const {answer}=await import('./result.mjs'); assert.equal(answer,42);";
  const tasks = tailSteps ? [{ id: "long-phase", prompts: [`CONTROLLED_USE_WEB: read example.com, write the result, release optional tools, then perform ${tailSteps} core write steps.`], files: {},
    verify: verify + `import {readFile} from 'node:fs/promises'; for(let i=1;i<=${tailSteps};i++) assert.equal(await readFile('steps/step_'+i+'.txt','utf8'),'step '+i);` }]
    : [{ id: "inactive", prompts: ["CONTROLLED_IDLE: write the result module using core tools."], files: {}, verify },
      { id: "active-release", prompts: ["CONTROLLED_USE_WEB: read example.com, write the result and release optional tools."], files: {}, verify }];
  await writeJson(join(workspace, "suite.json"), { name: "Controlled harness comparison, no real LLM", provider: "controlled-local", model: "fixture", repetitions: 1,
    modes: ["native", "resident", "streaming"], timeoutMs: 60000, measureMemory: true,
    tasks,
  });
  const report = await runBenchmark("suite.json", false, workspace);
  assert.ok("results" in report);
  assert.equal(groups.length, report.results.length, "one request group per isolated conversation");
  const results = report.results.map((run, i) => ({ ...run, wire: groups[i],
    serializedInputBytes: groups[i].requests.reduce((n, r) => n + r.inputBytes, 0),
    warning: "Scripted actions. Input sizes are UTF-8 JSON bytes, not tokenizer counts. Zero usage is not a real model cost." }));
  for (const { id: task } of tasks) {
    const resident = results.find(r => r.task === task && r.mode === "resident")!;
    const streaming = results.find(r => r.task === task && r.mode === "streaming")!;
    assert.deepEqual(resident.wire.requests.map((r: { schemaHash: string }) => r.schemaHash), streaming.wire.requests.map((r: { schemaHash: string }) => r.schemaHash), "context-only and streaming must expose the same schemas for the same sequence");
  }
  await writeJson(join(workspace, "comparison.json"), { capturedAt: new Date().toISOString(), runRoot: report.runRoot, schemasMatch: true, results });
  console.log(`Controlled comparison: ${join(workspace, "comparison.json")}`);
  if (results.some(r => !r.passed)) process.exitCode = 1;
} finally {
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
  if (oldOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = oldOffline;
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
}
