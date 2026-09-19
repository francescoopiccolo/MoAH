import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const source = join("src", "vendor");
const target = join("dist", "src", "vendor");

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });

const piDist = join("node_modules", "@earendil-works", "pi-coding-agent", "dist");
const modesSource = join(piDist, "modes");
const modesTarget = join("dist", "modes");
await mkdir(modesTarget, { recursive: true });
await cp(modesSource, modesTarget, { recursive: true, force: true });
