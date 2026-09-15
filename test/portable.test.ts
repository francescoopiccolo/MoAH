import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, sep } from "node:path";
import { defaultConfig } from "../src/config.js";
import { resolvePackage } from "../src/catalog.js";

test("portable defaults need no embedding download and resolve bundled tools outside the checkout", async () => {
  const root = await realpath(tmpdir());
  const dir = await mkdtemp(join(root, "moah-portable-test-"));
  try {
    const config = defaultConfig();
    assert.equal(config.router.enabled, false);
    assert.equal(config.router.device, "cpu");
    const pkg = await resolvePackage(config.packages[0], dir);
    assert.match(pkg.entry, /pi-web-tools[\\/]index\.ts$/);
  } finally {
    const rel = relative(root, await realpath(dir));
    if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) throw Error("Unsafe cleanup");
    await rm(dir, { recursive: true, force: true });
  }
});
