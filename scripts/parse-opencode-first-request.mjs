import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: node parse-opencode-first-request.mjs <file>");
const payload = JSON.parse(await readFile(file, "utf8"));

const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
const tokens = value => Math.ceil(bytes(value) / 4);
const system = payload.system ?? [];
const messages = payload.messages ?? [];
const tools = payload.tools ?? {};
const totalBytes = bytes(payload);

console.log(JSON.stringify({
  toolsExposed: Object.keys(tools),
  toolCount: Object.keys(tools).length,
  systemBytes: bytes(system),
  systemTokens: tokens(system),
  messagesBytes: bytes(messages),
  messagesTokens: tokens(messages),
  toolsBytes: bytes(tools),
  toolsTokens: tokens(tools),
  otherBytes: Math.max(0, totalBytes - bytes(system) - bytes(messages) - bytes(tools)),
  otherTokens: tokens(Math.max(0, totalBytes - bytes(system) - bytes(messages) - bytes(tools))),
  totalBytes,
  totalTokens: tokens(totalBytes),
}, null, 2));
