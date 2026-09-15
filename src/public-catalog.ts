import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { stateDir, writeJson } from "./config.js";
import { lexicalSearch } from "./capabilities.js";

export interface PublicPackage { name: string; version: string; description: string; types: string[]; url: string; installSource: string }
export interface PublicCatalog { schema: 1; source: string; capturedAt: string; total: number; pages: number; contentHash: string; packages: PublicPackage[] }
export function searchPublicCatalog(query: string, packages: PublicPackage[]): PublicPackage[] {
  const exact = packages.find(p => p.name.toLowerCase() === query.trim().toLowerCase());
  return exact ? [exact] : lexicalSearch(query, packages);
}
const source = "https://pi.dev/packages";
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
  if (entity[0] === "#") return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === "x" ? 2 : 1), entity[1].toLowerCase() === "x" ? 16 : 10));
  return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[entity.toLowerCase()];
});
export function parsePublicCatalogPage(html: string) {
  const range = html.match(/(\d+)-(\d+)\s*\/\s*(\d+)/);
  if (!range) throw new Error("Pi catalog pagination missing; refusing a partial import");
  const packages: PublicPackage[] = [];
  for (const [card] of html.matchAll(/<article\b[\s\S]*?<\/article>/g)) {
    const attribute = (key: string) => decode(card.match(new RegExp(`${key}="([^"]*)"`))?.[1] ?? "");
    const name = attribute("data-package-name");
    if (!name) continue;
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error(`Invalid npm name: ${name}`);
    const version = decode(card.match(/package-version=([^"&]+)/)?.[1] ?? "");
    if (!version) throw new Error(`Pi did not report a version for ${name}`);
    packages.push({ name, version: decodeURIComponent(version), description: decode(card.match(/<p class="packages-desc">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]*>/g, "") ?? ""),
      types: attribute("data-package-types").split(/[ ,]+/).filter(Boolean), url: `${source}/${encodeURIComponent(name)}`,
      installSource: `npm:${name}@${decodeURIComponent(version)}` });
  }
  const [, from, to, total] = range.map(Number);
  if (packages.length !== to - from + 1) throw new Error(`Pi page cardinality mismatch: ${packages.length} vs ${to - from + 1}`);
  return { from, to, total, packages };
}

export async function syncPublicCatalog(cwd: string, progress = console.log, fetchPage = async (page: number) => {
  const response = await fetch(`${source}?sort=name&page=${page}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Pi catalog HTTP ${response.status} on page ${page}`);
  return response.text();
}) {
  const first = parsePublicCatalogPage(await fetchPage(1));
  const pageSize = first.to;
  const pages = Math.ceil(first.total / pageSize);
  const all = [...first.packages];
  // Name order is less volatile than download ranking; two concurrent reads bound server load.
  for (let page = 2; page <= pages; page += 2) {
    const batch = await Promise.allSettled([page, page + 1].filter(p => p <= pages).map(async p => {
      const result = parsePublicCatalogPage(await fetchPage(p));
      if (result.total !== first.total || result.from !== (p - 1) * pageSize + 1) throw new Error("Catalog changed during import; retry to obtain complete coverage");
      return result.packages;
    }));
    for (const result of batch) { if (result.status === "rejected") throw result.reason; all.push(...result.value); }
    progress(`Pi catalog: ${all.length}/${first.total}`);
  }
  if (all.length !== first.total || new Set(all.map(p => p.name)).size !== first.total) throw new Error("Missing or duplicate catalog entries; previous snapshot preserved");
  // Recheck boundaries/count; the public site offers no atomic snapshot API.
  const check = parsePublicCatalogPage(await fetchPage(1));
  if (check.total !== first.total || JSON.stringify(check.packages) !== JSON.stringify(first.packages)) throw new Error("Catalog changed during import; retry");
  all.sort((a, b) => a.name.localeCompare(b.name));
  const result: PublicCatalog = { schema: 1, source, capturedAt: new Date().toISOString(), total: all.length, pages,
    contentHash: createHash("sha256").update(JSON.stringify(all)).digest("hex"), packages: all };
  await writeJson(join(stateDir(cwd), "public-catalog.json"), result);
  return result;
}

export async function readPublicCatalog(cwd: string): Promise<PublicCatalog | undefined> {
  const raw = await readFile(join(stateDir(cwd), "public-catalog.json"), "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return undefined; throw e; });
  if (!raw) return undefined;
  const result = JSON.parse(raw) as PublicCatalog;
  if (result.schema !== 1 || result.total !== result.packages.length || new Set(result.packages.map(p => p.name)).size !== result.total ||
      createHash("sha256").update(JSON.stringify(result.packages)).digest("hex") !== result.contentHash) throw new Error("Invalid public catalog snapshot; run catalog-sync");
  return result;
}
