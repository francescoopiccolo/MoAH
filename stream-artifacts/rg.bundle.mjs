// data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions/truncated-tool.ts
import { mkdtemp, writeFile } from "node:fs/promises";

// src/worker-sdk/pi-coding-agent.ts
var DEFAULT_MAX_BYTES = 50 * 1024;
var DEFAULT_MAX_LINES = 2e3;
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}
function truncateHead(input, options) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = input.split("\n");
  const head = lines.slice(0, maxLines).join("\n");
  let content = head;
  let truncated = lines.length > maxLines;
  const bytes = Buffer.byteLength(input, "utf8");
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    content = Buffer.from(content, "utf8").subarray(0, maxBytes).toString("utf8");
    truncated = true;
  }
  return {
    content,
    truncated,
    totalLines: lines.length,
    outputLines: content.split("\n").length,
    totalBytes: bytes,
    outputBytes: Buffer.byteLength(content, "utf8")
  };
}
async function withFileMutationQueue(_path, fn) {
  return fn();
}

// src/worker-sdk/pi-tui.ts
var Text = class {
  constructor(text, _x = 0, _y = 0) {
    this.text = text;
  }
  text;
};

// data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions/truncated-tool.ts
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { Type } from "typebox";
var RgParams = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex)" }),
  path: Type.Optional(Type.String({ description: "Directory to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "File glob pattern, e.g. '*.ts'" }))
});
function truncated_tool_default(pi) {
  pi.registerTool({
    name: "rg",
    label: "ripgrep",
    // Document the truncation limits in the tool description so the LLM knows
    description: `Search file contents using ripgrep. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). If truncated, full output is saved to a temp file.`,
    parameters: RgParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { pattern, path: searchPath, glob } = params;
      const args = ["rg", "--line-number", "--color=never"];
      if (glob) args.push("--glob", glob);
      args.push(pattern);
      args.push(searchPath || ".");
      let output;
      try {
        output = execSync(args.join(" "), {
          cwd: ctx.cwd,
          encoding: "utf-8",
          maxBuffer: 100 * 1024 * 1024
          // 100MB buffer to capture full output
        });
      } catch (err) {
        if (err.status === 1) {
          return {
            content: [{ type: "text", text: "No matches found" }],
            details: { pattern, path: searchPath, glob, matchCount: 0 }
          };
        }
        throw new Error(`ripgrep failed: ${err.message}`);
      }
      if (!output.trim()) {
        return {
          content: [{ type: "text", text: "No matches found" }],
          details: { pattern, path: searchPath, glob, matchCount: 0 }
        };
      }
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES
      });
      const matchCount = output.split("\n").filter((line) => line.trim()).length;
      const details = {
        pattern,
        path: searchPath,
        glob,
        matchCount
      };
      let resultText = truncation.content;
      if (truncation.truncated) {
        const tempDir = await mkdtemp(join(tmpdir(), "pi-rg-"));
        const tempFile = join(tempDir, "output.txt");
        await withFileMutationQueue(tempFile, async () => {
          await writeFile(tempFile, output, "utf8");
        });
        details.truncation = truncation;
        details.fullOutputPath = tempFile;
        const truncatedLines = truncation.totalLines - truncation.outputLines;
        const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
        resultText += `

[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
        resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
        resultText += ` Full output saved to: ${tempFile}]`;
      }
      return {
        content: [{ type: "text", text: resultText }],
        details
      };
    },
    // Custom rendering of the tool call (shown before/during execution)
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("rg "));
      text += theme.fg("accent", `"${args.pattern}"`);
      if (args.path) {
        text += theme.fg("muted", ` in ${args.path}`);
      }
      if (args.glob) {
        text += theme.fg("dim", ` --glob ${args.glob}`);
      }
      return new Text(text, 0, 0);
    },
    // Custom rendering of the tool result
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details;
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching..."), 0, 0);
      }
      if (!details || details.matchCount === 0) {
        return new Text(theme.fg("dim", "No matches found"), 0, 0);
      }
      let text = theme.fg("success", `${details.matchCount} matches`);
      if (details.truncation?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }
      if (expanded) {
        const content = result.content[0];
        if (content?.type === "text") {
          const lines = content.text.split("\n").slice(0, 20);
          for (const line of lines) {
            text += `
${theme.fg("dim", line)}`;
          }
          if (content.text.split("\n").length > 20) {
            text += `
${theme.fg("muted", "... (use read tool to see full output)")}`;
          }
        }
        if (details.fullOutputPath) {
          text += `
${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
        }
      }
      return new Text(text, 0, 0);
    }
  });
}
export {
  truncated_tool_default as default
};
