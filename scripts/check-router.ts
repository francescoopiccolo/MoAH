import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createCodingTools, createGrepTool, createFindTool, createLsTool } from "@earendil-works/pi-coding-agent";
import { readConfig, stateDir, writeJson } from "../src/config.js";
import { readCatalog } from "../src/catalog.js";
import { LocalEmbedder, ToolRouter } from "../src/router.js";

const cwd = process.cwd();
const config = await readConfig();
const catalog = await readCatalog(config, cwd);
const candidates = [...createCodingTools(cwd), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd), ...catalog.flatMap(p => p.tools)];
const cases = [
  { query: "Search the web for recent TypeScript releases", expected: "websearch" },
  { query: "Fetch the contents of https://pi.dev/docs/latest/extensions", expected: "webfetch" },
  { query: "Find all .ts files in this repository", expected: "find" },
  { query: "Search file contents for TODO", expected: "grep" },
  { query: "Read package.json", expected: "read" },
  { query: "Cerca sul web la documentazione di Pi e leggi la pagina ufficiale", expected: "websearch" },
  { query: "Elenca i file e le cartelle presenti nella directory", expected: "ls" },
];
const router = new ToolRouter(new LocalEmbedder(config.router, join(stateDir(cwd), "models")), config.router, join(stateDir(cwd), "embeddings"));
const start = performance.now();
const results = [];
try {
  for (const item of cases) {
    router.reset();
    const route = await router.route(item.query, candidates);
    const pass = route.ranked.slice(0, 2).some(t => t.name === item.expected);
    results.push({ ...item, pass, top2: route.ranked.slice(0, 2), selected: route.selected, elapsedMs: route.elapsedMs });
  }
} finally { await router.dispose(); }
const report = { purpose: "Small functional smoke test, not a benchmark or a quality claim", model: config.router.model, device: config.router.device,
  dtype: config.router.dtype, timestamp: new Date().toISOString(), elapsedMs: performance.now() - start, results };
await writeJson(join(stateDir(cwd), "router-smoke.json"), report);
console.log(JSON.stringify(report, null, 2));
if (results.some(r => !r.pass)) process.exitCode = 1;
