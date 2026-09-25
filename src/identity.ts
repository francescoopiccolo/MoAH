import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PI_VERSION } from "./corpus.js";

export function moahVersion(): string {
  const candidates = [new URL("../package.json", import.meta.url), new URL("../../package.json", import.meta.url)];
  const packagePath = candidates.map(url => fileURLToPath(url)).find(path => existsSync(path));
  if (!packagePath) throw new Error("MoAH package manifest not found");
  return JSON.parse(readFileSync(packagePath, "utf8")).version;
}

export function identitySummary(): string {
  return `MoAH ${moahVersion()}\nAgent engine: Pi ${PI_VERSION} (bundled)\nTool routing and loading: MoAH\nProject: https://github.com/francescoopiccolo/MoAH`;
}
