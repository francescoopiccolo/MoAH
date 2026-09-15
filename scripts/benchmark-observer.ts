import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Same observer in every condition. No payload text, authorization headers or secrets are persisted.
export default function observer(pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload as Record<string, unknown>;
    const schemas = JSON.stringify(payload.tools ?? []);
    appendFileSync(join(ctx.cwd, "provider-metrics.jsonl"), JSON.stringify({ time: new Date().toISOString(),
      schemaBytes: Buffer.byteLength(schemas), schemaHash: createHash("sha256").update(schemas).digest("hex"),
      serializedPayloadBytes: Buffer.byteLength(JSON.stringify(payload)),
      names: Array.isArray(payload.tools) ? payload.tools.map((t: any) => t.function?.name ?? t.name) : [],
    }) + "\n");
  });
}
