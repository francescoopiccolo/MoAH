import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export default function (pi) {
  const dir = join(process.cwd(), ".moah", "request-capture");
  mkdirSync(dir, { recursive: true });
  pi.on("before_provider_request", event => {
    appendFileSync(join(dir, "requests.jsonl"), JSON.stringify({ time: new Date().toISOString(), payload: event.payload }) + "\n");
  });
}
