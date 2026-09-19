export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;

export function defineTool<T extends Record<string, unknown>>(tool: T): T {
  return tool;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
  totalBytes: number;
  outputBytes: number;
}

export function truncateHead(input: string, options: { maxLines?: number; maxBytes?: number }): TruncationResult {
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
    outputBytes: Buffer.byteLength(content, "utf8"),
  };
}

export function truncateLine(input: string, maxLength: number): string {
  return input.length > maxLength ? `${input.slice(0, maxLength)}…` : input;
}

export function truncateTail(input: string, options: { maxLines?: number; maxBytes?: number }): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = input.split("\n");
  const tail = lines.slice(-maxLines).join("\n");
  let content = tail;
  const truncated = lines.length > maxLines || Buffer.byteLength(content, "utf8") > maxBytes;
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    content = Buffer.from(content, "utf8").subarray(0, maxBytes).toString("utf8");
  }
  return {
    content,
    truncated,
    totalLines: lines.length,
    outputLines: content.split("\n").length,
    totalBytes: Buffer.byteLength(input, "utf8"),
    outputBytes: Buffer.byteLength(content, "utf8"),
  };
}

export async function withFileMutationQueue<T>(_path: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}
