import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const piPackage = name => name.startsWith("@earendil-works/") || name.startsWith("@mariozechner/");

const normalPiDeps = Object.keys(pkg.dependencies ?? {}).filter(piPackage);
const devPiDeps = Object.keys(pkg.devDependencies ?? {}).filter(piPackage);

async function findFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findFiles(path));
    else if (entry.name.endsWith(".js")) out.push(path);
  }
  return out;
}

const nonVendorFiles = (await findFiles("dist/src")).filter(path => !path.includes(`${join("dist", "src", "vendor")}`));
const nonVendorPiCodingImports = [];
for (const file of nonVendorFiles) {
  const text = await readFile(file, "utf8");
  if (/from\s*["']@earendil-works\/pi-coding-agent["']/.test(text) ||
      /import\s*\(\s*["']@earendil-works\/pi-coding-agent["']\s*\)/.test(text)) {
    nonVendorPiCodingImports.push(file);
  }
}

console.log(JSON.stringify({
  normalRuntimePiPackages: normalPiDeps,
  devOrBenchmarkPiPackages: devPiDeps,
  nonVendorPiCodingAgentImports: nonVendorPiCodingImports,
  workerShimFiles: ["dist/src/worker-sdk/pi-coding-agent.js", "dist/src/worker-sdk/pi-ai.js", "dist/src/worker-sdk/pi-tui.js"],
  vendorPiRuntime: "dist/src/vendor/pi-runtime",
}, null, 2));
