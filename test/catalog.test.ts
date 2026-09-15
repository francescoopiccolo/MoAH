import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildCatalog, nativeArguments, sourceFingerprint } from "../src/catalog.js";
import { fixtureConfig, temporaryDirectory } from "./helpers.js";

test("streamed hashing remains compatible with existing package fingerprints", async () => {
  const tmp = await temporaryDirectory();
  try {
    const data = Buffer.alloc(2 * 1024 ** 2 + 17, 0xa5);
    await writeFile(join(tmp.path, "data.bin"), data);
    const expected = createHash("sha256").update("data.bin\0").update(data).digest("hex");
    assert.equal(await sourceFingerprint(tmp.path), expected);
    data[data.length - 1] = 0;
    await writeFile(join(tmp.path, "data.bin"), data);
    assert.notEqual(await sourceFingerprint(tmp.path), expected);
  } finally { await tmp.cleanup(); }
});

test("native package roots retain all resource types through Pi's own resolver", async () => {
  const tmp = await temporaryDirectory();
  const config = await fixtureConfig();
  config.packages = [{ id: "native", entry: resolve("test/fixtures/native-package"), mode: "native" }];
  try {
    const [pkg] = await buildCatalog(config, tmp.path);
    assert.equal(pkg.mode, "native");
    assert.equal(pkg.resources.extensions.length, 1);
    assert.equal(pkg.resources.skills.length, 1);
    assert.equal(pkg.resources.prompts.length, 1);
    assert.deepEqual(nativeArguments([pkg]), ["-e", pkg.root]);
  } finally { await tmp.cleanup(); }
});
test("streaming opt-in never loses an unsupported package", async () => {
  const tmp = await temporaryDirectory();
  const config = await fixtureConfig();
  config.packages = [{ id: "unsupported", entry: resolve("test/fixtures/unsupported.mjs"), mode: "stream", stateless: true }];
  try {
    const [pkg] = await buildCatalog(config, tmp.path);
    assert.equal(pkg.mode, "native");
    assert.match(pkg.reason, /fallback/);
    assert.equal(nativeArguments([pkg])[1], pkg.entry);
  } finally { await tmp.cleanup(); }
});
