import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: node parse-first-request.mjs <file>");

const text = await readFile(file, "utf8");
let payload;
for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const obj = JSON.parse(line);
  if (obj.event === "provider_request") payload = obj.payload;
  else if (obj.payload) payload = obj.payload;
  if (payload) break;
}

if (!payload) throw new Error("No payload found");

const tokens = bytes => Math.ceil(bytes / 4);
const systemMessage = payload.messages?.find(m => m.role === "system");
const userMessages = payload.messages?.filter(m => m.role === "user") ?? [];
const systemBytes = Buffer.byteLength(systemMessage?.content ?? "", "utf8");
const userBytes = Buffer.byteLength(JSON.stringify(userMessages), "utf8");
const tools = payload.tools ?? [];
const toolsBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
const otherBytes = Math.max(0, Buffer.byteLength(JSON.stringify(payload), "utf8") - systemBytes - userBytes - toolsBytes);

console.log(JSON.stringify({
  toolsExposed: tools.map(tool => tool?.function?.name ?? tool?.name ?? "?"),
  toolCount: tools.length,
  systemBytes,
  systemTokens: tokens(systemBytes),
  userBytes,
  userTokens: tokens(userBytes),
  toolsBytes,
  toolsTokens: tokens(toolsBytes),
  otherBytes,
  otherTokens: tokens(otherBytes),
  totalBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
  totalTokens: tokens(Buffer.byteLength(JSON.stringify(payload), "utf8")),
}, null, 2));
