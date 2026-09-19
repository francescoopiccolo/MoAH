import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const source = join("node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes");
const target = join("src", "modes");

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
