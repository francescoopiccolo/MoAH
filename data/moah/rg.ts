import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const RgParams = Type.Object({
  pattern: Type.String({ minLength: 1, description: "Search pattern (regex)" }),
  path: Type.Optional(Type.String({ description: "Directory to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "File glob pattern, e.g. '*.ts'" })),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "rg",
    label: "ripgrep",
    description: `Search file contents using ripgrep. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: RgParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { pattern, path: searchPath, glob } = params;
      if (typeof pattern !== "string" || !pattern.trim()) {
        throw new Error("rg requires a non-empty pattern");
      }

      const args = ["--line-number", "--color=never"];
      if (glob) args.push("--glob", glob);
      args.push("--", pattern, searchPath || ".");

      let output: string;
      try {
        output = execFileSync("rg", args, {
          cwd: ctx.cwd,
          encoding: "utf8",
          maxBuffer: 100 * 1024 * 1024,
          windowsHide: true,
        });
      } catch (error: any) {
        if (error.status === 1) {
          return {
            content: [{ type: "text", text: "No matches found" }],
            details: { pattern, path: searchPath, glob, matchCount: 0 },
          };
        }
        throw new Error(`ripgrep failed: ${error.message}`);
      }

      if (!output.trim()) {
        return {
          content: [{ type: "text", text: "No matches found" }],
          details: { pattern, path: searchPath, glob, matchCount: 0 },
        };
      }

      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      const details: Record<string, unknown> = {
        pattern,
        path: searchPath,
        glob,
        matchCount: output.split("\n").filter(line => line.trim()).length,
      };
      let resultText = truncation.content;

      if (truncation.truncated) {
        const tempDir = await mkdtemp(join(tmpdir(), "moah-rg-"));
        const tempFile = join(tempDir, "output.txt");
        await withFileMutationQueue(tempFile, async () => {
          await writeFile(tempFile, output, "utf8");
        });
        details.truncation = truncation;
        details.fullOutputPath = tempFile;
        resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
        resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        resultText += ` Full output saved to: ${tempFile}]`;
      }

      return { content: [{ type: "text", text: resultText }], details };
    },
  });
}
