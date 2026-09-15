import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readConfig, stateDir, defaultConfig } from "./config.js";
import { buildCatalog, readCatalog, nativeArguments } from "./catalog.js";
import { ToolRouter, LocalEmbedder } from "./router.js";
import { ProcessPool } from "./pool.js";
import { createTrace } from "./trace.js";
import { createMoahExtension } from "./pi-extension.js";
import { measurePreparation } from "./workflow.js";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command = "help", ...rest] = args;
  const cwd = process.cwd();
  if (["help", "--help", "-h"].includes(command)) {
    console.log(`MoAH — Pi + model-selected capabilities + demand-loaded tool processes

  setup                  Index packages; prepare optional semantic search model if enabled
  init                   Create portable project settings without overwriting an existing file
  index                  Resolve all package resources; probe streaming candidates
  route <request>        Diagnose local semantic ranking (does not activate tools)
  demo [fetch <url>]     Run upstream webfetch (default: Pi's public README)
  demo search <query>    Run upstream websearch through the process cache
  doctor                 Inspect runtime, model files and catalog
  catalog                Inspect indexed packages and last live capability snapshot
  catalog-sync           Snapshot every package listed at pi.dev (metadata, no installation)
  catalog-search <query> [--offset N]  Search the complete public snapshot offline, in pages
  install <source>        Install a Pi package locally using Pi's own installer
  list                   List packages using Pi
  config                 Open Pi's project package configuration
  bench <suite.json> [--dry-run]  Compare native Pi, resident MoAH and streaming MoAH
  bench-controlled [--tail-steps N] [--config path]  Compare identical actions without a paid LLM
  pi [Pi arguments]      Start original Pi with MoAH
  dense [Pi arguments]   Start original Pi with the same packages loaded natively

Configuration: moah.config.json. Model downloads happen only during setup.
In Pi: /moah, /moah dense, /moah sparse. Credentials and login remain managed by Pi.`);
    return;
  }
  if (command === "init") {
    if (rest.length) throw new Error("Usage: moah init (inside your project)");
    await writeFile(join(cwd, "moah.config.json"), JSON.stringify(defaultConfig(), null, 2) + "\n", { flag: "wx" });
    console.log("Created moah.config.json. Run moah index, then moah pi. Semantic retrieval is off by default; Pi manages model login.");
    return;
  }
  if (["install", "remove", "update", "list", "config"].includes(command)) {
    if (["install", "remove"].includes(command) && rest.length !== 1) throw new Error(`Usage: moah ${command} <Pi source>`);
    const pi = await import("@earendil-works/pi-coding-agent");
    await measurePreparation(cwd, `pi-${command}`, () => pi.main([command, ...rest, ...(["install", "remove", "config"].includes(command) ? ["-l"] : [])]));
    return;
  }
  const config = await readConfig(resolve(cwd, "moah.config.json"));
  if (command === "catalog-sync" || command === "catalog-search") {
    const { syncPublicCatalog, readPublicCatalog, searchPublicCatalog } = await import("./public-catalog.js");
    if (command === "catalog-sync") {
      const result = await measurePreparation(cwd, "catalog-sync", () => syncPublicCatalog(cwd));
      console.log(JSON.stringify({ total: result.total, pages: result.pages, contentHash: result.contentHash, capturedAt: result.capturedAt }));
    } else {
      const catalog = await readPublicCatalog(cwd);
      if (!catalog) throw new Error("Run catalog-sync first");
      const offsetIndex = rest.indexOf("--offset");
      const offset = offsetIndex < 0 ? 0 : Number(rest[offsetIndex + 1]);
      if (!Number.isSafeInteger(offset) || offset < 0 || (offsetIndex >= 0 && rest.indexOf("--offset", offsetIndex + 1) >= 0)) throw new Error("--offset must be one nonnegative integer");
      const query = rest.filter((_, i) => offsetIndex < 0 || (i !== offsetIndex && i !== offsetIndex + 1)).join(" ");
      const found = searchPublicCatalog(query, catalog.packages);
      const page = found.slice(offset, offset + config.selection.catalogPageSize);
      console.log(JSON.stringify({ total: found.length, offset, nextOffset: offset + page.length < found.length ? offset + page.length : null, packages: page }, null, 2));
    }
    return;
  }
  if (command === "bench-controlled") {
    if (rest.length % 2 || rest.some((v, i) => i % 2 === 0 && !["--tail-steps", "--config"].includes(v))) throw new Error("Usage: moah bench-controlled [--tail-steps N] [--config path]");
    await import("../scripts/controlled-comparison.js"); return;
  }
  if (command === "bench") {
    if (!rest[0] || rest.slice(1).some(a => a !== "--dry-run")) throw new Error("Usage: moah bench <suite.json> [--dry-run]");
    const { runBenchmark } = await import("./benchmark.js");
    const result = await runBenchmark(rest[0], rest.includes("--dry-run"), cwd);
    if ("results" in result && result.results.some(r => !r.passed)) process.exitCode = 1;
    return;
  }
  if (command === "index" || command === "setup") {
    const catalog = await measurePreparation(cwd, "index", () => buildCatalog(config, cwd));
    console.log(`Indexed ${catalog.length} package(s), ${catalog.flatMap(p => p.tools).length} streamed tool definitions. Native tools are discovered by Pi at runtime.`);
    for (const p of catalog) console.log(`${p.id} [${p.mode}]: ${p.reason}`);
    if (command === "setup" && config.router.enabled) {
      console.log(`Preparing ${config.router.model} (${config.router.device}/${config.router.dtype})...`);
      const embedder = new LocalEmbedder(config.router, join(stateDir(cwd), "models"), true);
      try { await embedder.embed(["Cerca gli strumenti utili per questo compito."]); }
      finally { await embedder.dispose(); }
      console.log("Local model ready. Inference now works offline.");
    }
    return;
  }
  if (command === "doctor") {
    const { listSupportedBackends } = await import("onnxruntime-node");
    const report: Record<string, unknown> = { node: process.version, pi: "0.85.1", mode: "model-selected", selection: config.selection, backends: listSupportedBackends(), router: config.router,
      modelCacheExists: existsSync(join(stateDir(cwd), "models")), mainModelLogin: "Managed by Pi; use /login in Pi" };
    report.externalTools = Object.fromEntries(["ddgr", "pandoc", "sh"].map(name => {
      const check = spawnSync(name, ["--version"], { windowsHide: true, timeout: 5000, encoding: "utf8" });
      return [name, { available: !check.error && check.status === 0 }];
    }));
    try { report.catalog = (await readCatalog(config, cwd)).map(p => ({ id: p.id, mode: p.mode, reason: p.reason, resources: p.resources, tools: p.tools.map(t => t.name) })); }
    catch (error) { report.catalogError = String(error); process.exitCode = 1; }
    console.log(JSON.stringify(report, null, 2)); return;
  }
  const catalog = await readCatalog(config, cwd);
  if (command === "catalog") {
    let snapshot: unknown;
    try { snapshot = JSON.parse(await readFile(join(stateDir(cwd), "capabilities.json"), "utf8")); } catch { snapshot = "No live snapshot yet. Start Pi and use /moah catalog."; }
    console.log(JSON.stringify({ packages: catalog, lastSessionSnapshot: snapshot }, null, 2)); return;
  }
  if (command === "dense") {
    const pi = await import("@earendil-works/pi-coding-agent");
    await pi.main([...nativeArguments(catalog, true), ...rest]); return;
  }
  if (command === "route") {
    if (!rest.length) throw new Error("Usage: moah route <request>");
    const pi = await import("@earendil-works/pi-coding-agent");
    const builtin = [...pi.createCodingTools(cwd), pi.createGrepTool(cwd), pi.createFindTool(cwd), pi.createLsTool(cwd)];
    const unique = [...new Map([...builtin, ...catalog.flatMap(p => p.tools)].map(t => [t.name, t])).values()];
    const router = new ToolRouter(new LocalEmbedder(config.router, join(stateDir(cwd), "models")), config.router, join(stateDir(cwd), "embeddings"));
    try { console.log(JSON.stringify(await router.route(rest.join(" "), unique), null, 2)); }
    finally { await router.dispose(); } return;
  }
  if (command === "demo") {
    const name = rest[0] === "search" ? "websearch" : "webfetch";
    if (rest[0] && !["fetch", "search"].includes(rest[0])) throw new Error("Usage: demo [fetch <url> | search <query>]");
    if (name === "websearch" && rest.length < 2) throw new Error("Usage: demo search <query>");
    if (!catalog.some(p => p.tools.some(t => t.name === name))) throw new Error(`Demo requires the configured upstream ${name} tool`);
    const trace = createTrace(join(stateDir(cwd), "traces"));
    const pool = new ProcessPool(catalog, cwd, config.cache, trace);
    try {
      console.log("Before execution:", pool.snapshot());
      const args = name === "websearch"
        ? { query: rest.slice(1).join(" "), limit: 3, region: null, safesearch: null, time: null }
        : { url: rest[1] ?? "https://raw.githubusercontent.com/earendil-works/pi/main/README.md", max_chars: 2000, offset: 0 };
      const result = await pool.execute(name, args, "demo");
      console.log("Upstream result:", JSON.stringify(result));
      if (result.isError) process.exitCode = 1;
      console.log("Resident processes:", pool.snapshot());
    } finally { await pool.close(); }
    console.log("After release:", pool.snapshot()); return;
  }
  if (command === "pi") {
    const pi = await import("@earendil-works/pi-coding-agent");
    for (const p of catalog.filter(p => p.mode === "unavailable")) console.warn(`MoAH ${p.id}: ${p.reason}`);
    await pi.main([...nativeArguments(catalog), ...rest], { extensionFactories: [{ name: "moah", factory: createMoahExtension({ cwd, config, catalog }) }] }); return;
  }
  throw new Error(`Unknown command: ${command}. Run moah help`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
