import type { ToolCandidate } from "./types.js";

export const SELECT = "moah_select";
export const isControl = (name: string) => name === SELECT;

export function compactDescription(description: string, maxCharacters: number): string {
  const text = description.replace(/\s+/g, " ").trim();
  return text.length > maxCharacters ? text.slice(0, maxCharacters - 1) + "…" : text;
}

export function toCandidate(tool: { name: string; description: string }, maxCharacters: number): ToolCandidate {
  return { name: tool.name, description: compactDescription(tool.description, maxCharacters) };
}

export function validateSelection(
  requested: string[],
  available: ToolCandidate[],
  maxOptional: number,
): string[] {
  if (!Array.isArray(requested) || requested.some(name => typeof name !== "string")) {
    throw new Error("tools must be an array of exact tool names");
  }
  const names = [...new Set(requested)];
  const known = new Set(available.map(tool => tool.name));
  const unknown = names.filter(name => !known.has(name));
  if (unknown.length) throw new Error(`Unknown or unavailable tools: ${unknown.join(", ")}`);
  if (names.length > maxOptional) throw new Error(`Choose at most ${maxOptional} optional tools`);
  return names;
}
