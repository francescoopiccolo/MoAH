import { mkdir, mkdtemp, rm, realpath } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { readConfig } from "../src/config.js";

export async function fixtureConfig() {
  const config = await readConfig();
  config.packages = [{ id: "fixture", entry: resolve("test/fixtures/tools.mjs"), stateless: true }];
  config.router = { ...config.router, model: "test", pinnedTools: ["read"], topK: 1, minimumScore: 0.1, keepMargin: 0 };
  return config;
}
export async function temporaryDirectory() {
  const root = resolve(".moah/test-runs");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "run-"));
  return { path, async cleanup() {
    const rel = relative(await realpath(root), await realpath(path));
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Unsafe test cleanup path");
    await rm(path, { recursive: true, force: true });
  } };
}
