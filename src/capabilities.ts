import type { ToolCandidate } from "./types.js";

export const ACTIVATE = "moah_activate";
export const DISCOVER = "moah_discover";
export const CATALOG_MESSAGE = "moah_capability_catalog";
export const isControl = (name: string) => name === ACTIVATE || name === DISCOVER;

export function compactCapability(tool: ToolCandidate, maxCharacters: number) {
  const text = tool.description.replace(/\s+/g, " ").trim();
  return { name: tool.name, description: text.length > maxCharacters ? text.slice(0, maxCharacters - 1) + "…" : text };
}

/** Exhaustive browsing remains available even when semantic search fails. */
export function lexicalSearch<T extends ToolCandidate>(query: string, tools: T[]): T[] {
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!terms.length) return [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return tools.map(tool => {
    const name = tool.name.toLocaleLowerCase();
    const description = tool.description.toLocaleLowerCase();
    const score = (name === query.trim().toLocaleLowerCase() ? 1000 : 0) +
      terms.reduce((sum, term) => sum + (name.includes(term) ? 3 : 0) + (description.includes(term) ? 1 : 0), 0);
    return { tool, score };
  }).filter(t => t.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).map(t => t.tool);
}

export function validateSelection(requested: string[], available: ToolCandidate[], pinned: string[], maxOptional: number): string[] {
  if (!Array.isArray(requested) || requested.some(n => typeof n !== "string")) throw new Error("tools must be an array of exact tool names");
  const names = [...new Set(requested)];
  const unknown = names.filter(n => !available.some(t => t.name === n));
  if (unknown.length) throw new Error(`Unknown or unavailable tools: ${unknown.join(", ")}. Browse moah_discover for eligible names.`);
  const optional = names.filter(n => !pinned.includes(n));
  if (optional.length > maxOptional) throw new Error(`Choose at most ${maxOptional} optional tools for the current phase; this operation replaces the previous selection.`);
  return optional;
}
