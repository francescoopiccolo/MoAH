import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkedPath, runBenchmark, runBounded, summarizeUsage, readMemorySamples } from "../src/benchmark.js";
import { writeJson } from "../src/config.js";
import { fixtureConfig, temporaryDirectory } from "./helpers.js";

test("benchmark fixtures cannot escape their workspace or overwrite runtime config", () => {
  const root = resolve(".moah/benchmark-tests");
  assert.equal(checkedPath(root, "src/a.js"), resolve(root, "src/a.js"));
    for (const bad of ["../outside", ".moah/catalog.json", ".pi/settings.json", "node_modules/foo.js", "provider-metrics.jsonl", "."]) assert.throws(() => checkedPath(root, bad));
});
test("benchmark missing usage is unknown, assistant failures are not successes", () => {
  const empty = summarizeUsage([]);
  assert.equal(empty.input, null);
  assert.equal(empty.estimatedCostUsd, null);
  const report = summarizeUsage([{ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "network failed",
    usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 0, cost: { total: 0.2 } } } },
    { type: "agent_end", messages: [{ role: "assistant", usage: { input: 10 } }] }]);
  assert.equal(report.input, 10, "agent_end summaries must not double-count message usage");
  assert.deepEqual(report.modelErrors, ["network failed"]);
});

test("benchmark can complete selected conditions without rerunning the others", async () => {
  const tmp = await temporaryDirectory();
  try {
    const suite = { name: "remaining", provider: "fixture", model: "fixture", repetitions: 1, timeoutMs: 1000,
      modes: ["native", "resident"], tasks: [{ id: "one", prompts: ["Do work"], files: {}, verify: "" }] };
    await writeJson(join(tmp.path, "suite.json"), suite);
    const plan = await runBenchmark("suite.json", true, tmp.path);
    assert.ok("runs" in plan); assert.equal(plan.runs, 2);
    for (const modes of [[], ["unknown"], ["native", "native"]]) {
      await writeJson(join(tmp.path, "suite.json"), { ...suite, modes });
      await assert.rejects(runBenchmark("suite.json", true, tmp.path), /Invalid benchmark modes/);
    }
    await writeJson(join(tmp.path, "suite.json"), { ...suite, tasks: [{ ...suite.tasks[0], verify: "const = broken" }] });
    await assert.rejects(runBenchmark("suite.json", true, tmp.path), /Invalid verification script/);
  } finally { await tmp.cleanup(); }
});
test("benchmark process timeout actually terminates the child", { timeout: 10000 }, async () => {
  const r = await runBounded(process.execPath, ["-e", "console.log(process.pid); setTimeout(()=>{},10000)"], process.cwd(), 700);
  assert.equal(r.timedOut, true);
  assert.throws(() => process.kill(Number(r.stdout.trim()), 0));
});

test("benchmark preserves UTF-8 characters split between output chunks", async () => {
  const run = await runBounded(process.execPath, ["-e", "process.stdout.write(Buffer.from([0xe2]));setTimeout(()=>process.stdout.write(Buffer.from([0x82,0xac])),50)"], process.cwd(), 5000);
  assert.equal(run.code, 0); assert.equal(run.stdout, "€");
});

test("Windows memory sampler observes the process tree and persists partial output", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const tmp = await temporaryDirectory();
  try {
    const memoryFile = join(tmp.path, "memory.jsonl");
    // Wait for observable sampling, not a fixed sleep shorter than cold CIM startup.
    await writeFile(join(tmp.path, "sample-child.cjs"), `
      const { readFileSync } = require('node:fs');
      const b = Buffer.alloc(32 * 1024 * 1024, 1);
      const deadline = Date.now() + 15000;
      const timer = setInterval(() => {
        let observed = false;
        try {
          observed = readFileSync('memory.jsonl', 'utf8').split('\\n').some(line => {
            try { const sample = JSON.parse(line); return sample.pids?.includes(process.pid) && sample.workingSetBytes > b.length; }
            catch { return false; }
          });
        } catch { /* sampler has not written yet */ }
        if (observed || Date.now() > deadline) {
          clearInterval(timer); console.log(observed ? 'sampled ' + b.length : 'sampling deadline');
          process.exitCode = observed ? 0 : 1;
        }
      }, 100);
    `);
    const run = await runBounded(process.execPath, ["-e", "const {spawn}=require('node:child_process');spawn(process.execPath,['sample-child.cjs'],{stdio:'inherit'}).once('exit',code=>process.exitCode=code??1);console.log('started');"], tmp.path, 20000,
      { stdoutFile: join(tmp.path, "out"), stderrFile: join(tmp.path, "err"), memoryFile });
    assert.equal(run.code, 0, await readFile(memoryFile, "utf8").catch(() => "Sampler produced no output")); assert.match(run.stdout, /started/);
    const memory = await readMemorySamples(memoryFile);
    assert.ok(memory.samples > 0); assert.ok(memory.sampledPeakWorkingSetBytes! > 32 * 1024 ** 2);
  } finally { await tmp.cleanup(); }
});

test("benchmark runs the original CLI in three isolated workspaces and evaluates outputs", { timeout: 90000 }, async () => {
  const tmp = await temporaryDirectory();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const first = !body.messages.some((m: any) => m.role === "tool" && m.tool_call_id === "write-fixture");
    const canWrite = body.tools.some((t: any) => t.function?.name === "write");
    const delta = first ? { role: "assistant", tool_calls: [{ index: 0, id: canWrite ? "write-fixture" : "activate-fixture", type: "function", function: {
      name: canWrite ? "write" : "moah_activate", arguments: JSON.stringify(canWrite ? { path: "answer.mjs", content: "export const answer = 42;\n" } : { tools: ["write"] }),
    } }] } : { role: "assistant", content: "Done" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }])
      res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", created: 1, choices: [choice] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const agentDir = join(tmp.path, "agent-config");
    await writeJson(join(agentDir, "models.json"), { providers: { "bench-fixture": {
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: "test-only", api: "openai-completions",
      models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_OFFLINE = "1";
    const config = await fixtureConfig(); config.packages = [];
    await writeJson(join(tmp.path, "moah.config.json"), config);
    await writeJson(join(tmp.path, "suite.json"), { name: "test-only", provider: "bench-fixture", model: "fixture", timeoutMs: 20000, repetitions: 1, observeProvider: true,
      tasks: [{ id: "answer", prompts: ["Write the answer module"], files: { "answer.mjs": "export const answer = 0;\n" },
        verify: "import assert from 'node:assert/strict'; const {answer}=await import('./answer.mjs'); assert.equal(answer,42);" }] });
    const result = await runBenchmark("suite.json", false, tmp.path);
    assert.ok("results" in result);
    assert.equal(result.results.length, 3);
    for (const run of result.results) {
      assert.equal(run.passed, true, JSON.stringify(run));
      assert.ok(run.preparationMs >= 0);
      assert.ok(run.providerRequests.length >= 2);
      assert.ok(run.providerRequests.every((r: any) => r.schemaBytes > 0 && r.schemaHash.length === 64));
    }
    assert.equal(new Set(result.results.map((r: any) => r.workspace)).size, 3);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    await tmp.cleanup();
  }
});
