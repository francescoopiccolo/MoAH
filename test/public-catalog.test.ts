import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublicCatalogPage, readPublicCatalog, syncPublicCatalog, searchPublicCatalog } from "../src/public-catalog.js";
import { temporaryDirectory } from "./helpers.js";

const page = (from: number, total: number, names: string[]) => `${from}-${from + names.length - 1} / ${total}` + names.map(name =>
  `<article data-package-name="${name}" data-package-types="extension skill"><p class="packages-desc">Search &amp; write</p><a href="https://example.com/?package-version=1.2.3">report</a></article>`).join("");
test("public Pi catalog imports every page, preserving names, types and versions", async () => {
  const tmp = await temporaryDirectory();
  try {
    const result = await syncPublicCatalog(tmp.path, () => {}, async n => n === 1 ? page(1, 3, ["@a/one", "b"]) : page(3, 3, ["c"]));
    assert.equal(result.total, 3); assert.equal(result.pages, 2);
    assert.equal(result.packages[0].installSource, "npm:@a/one@1.2.3");
    assert.equal(result.packages[0].description, "Search & write");
    assert.deepEqual(await readPublicCatalog(tmp.path), result);
    await assert.rejects(syncPublicCatalog(tmp.path, () => {}, async n => n === 1 ? page(1, 3, ["a", "b"]) : page(3, 3, ["b"])), /duplicate/);
    assert.deepEqual(await readPublicCatalog(tmp.path), result, "incomplete import must not replace existing snapshot");
    await assert.rejects(syncPublicCatalog(tmp.path, () => {}, async n => n === 1 ? page(1, 3, ["a", "b"]) : page(3, 4, ["c", "d"])), /changed/);
  } finally { await tmp.cleanup(); }
});
test("public catalog rejects changed HTML instead of silently dropping entries", () => {
  assert.throws(() => parsePublicCatalogPage("new format"), /pagination/);
  assert.throws(() => parsePublicCatalogPage("1-2 / 2"), /cardinality/);
});
test("an exact npm package query does not return every package matching the word pi", () => {
  const packages = parsePublicCatalogPage(page(1, 3, ["@one/pi-tools", "@two/pi-tools", "pi-other"])).packages;
  assert.deepEqual(searchPublicCatalog("@ONE/pi-tools", packages).map(p => p.name), ["@one/pi-tools"]);
  assert.equal(searchPublicCatalog("", packages).length, 3, "exhaustive browsing still includes everything");
});
