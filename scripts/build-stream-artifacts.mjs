import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const entries = {
  "hello.bundle.mjs": "node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts",
  "structured-output.bundle.mjs": "data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions/structured-output.ts",
  "rg.bundle.mjs": "data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions/truncated-tool.ts",
};

await mkdir("stream-artifacts", { recursive: true });

await build({
  entryPoints: Object.fromEntries(
    Object.entries(entries).map(([out, input]) => [out.replace(/\.mjs$/, ""), resolve(input)]),
  ),
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: "stream-artifacts",
  outExtension: { ".js": ".mjs" },
  alias: {
    "@earendil-works/pi-coding-agent": resolve("src/worker-sdk/pi-coding-agent.ts"),
    "@earendil-works/pi-ai": resolve("src/worker-sdk/pi-ai.ts"),
    "@earendil-works/pi-tui": resolve("src/worker-sdk/pi-tui.ts"),
    "@mariozechner/pi-coding-agent": resolve("src/worker-sdk/pi-coding-agent.ts"),
    "@mariozechner/pi-ai": resolve("src/worker-sdk/pi-ai.ts"),
    "@mariozechner/pi-tui": resolve("src/worker-sdk/pi-tui.ts"),
  },
  external: [
    "@sinclair/typebox",
    "typebox",
  ],
  logLevel: "info",
});

for (const name of Object.keys(entries)) {
  const text = await readFile(resolve("stream-artifacts", name), "utf8");
  for (const forbidden of [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ]) {
    const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(from\\s*["']${escaped}["']|import\\(\\s*["']${escaped}["']\\s*\\))`).test(text)) {
      throw new Error(`FORBIDDEN UPSTREAM RUNTIME IMPORT in ${name}: ${forbidden}`);
    }
  }
}
