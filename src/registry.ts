import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Capability, IndexedPackage } from "./types.js";
import { isControl } from "./capabilities.js";

export function inside(root: string, path: string): boolean {
  if (!root || !path || path.startsWith("<")) return false;
  const rel = relative(resolve(root), resolve(path));
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
export function ownsSource(pkg: IndexedPackage, path: string): boolean {
  return inside(pkg.nativeSource === pkg.root ? pkg.root : pkg.entry, path);
}

export function nativePreservedTools(pi: ExtensionAPI, packages: IndexedPackage[], streamed: Set<string>): string[] {
  const active = new Set(pi.getActiveTools());
  return pi.getAllTools().filter(t => {
    if (isControl(t.name) || streamed.has(t.name) || t.sourceInfo.source === "builtin" || !active.has(t.name)) return false;
    const owner = packages.find(p => ownsSource(p, t.sourceInfo.path));
    return owner?.context !== "dynamic";
  }).map(t => t.name);
}

export function buildRegistry(pi: ExtensionAPI, packages: IndexedPackage[], streamed: Set<string>, eligible: Set<string>): Capability[] {
  const active = new Set(pi.getActiveTools());
  const tools = pi.getAllTools().filter(t => !isControl(t.name));
  const commands = pi.getCommands().filter(c => c.name !== "moah");
  const registry: Capability[] = tools.map(t => {
    const owner = streamed.has(t.name) ? packages.find(p => p.tools.some(x => x.name === t.name)) : packages.find(p => ownsSource(p, t.sourceInfo.path));
    const isCore = t.sourceInfo.source === "builtin";
    return { id: `tool:${t.name}`, name: t.name, description: t.description, kind: "tool",
      execution: streamed.has(t.name) ? "stream" : isCore ? "core" : "native",
      availability: active.has(t.name) ? "available" : "inactive",
      activation: eligible.has(t.name) ? "tool" : "native",
      source: owner?.id ?? t.sourceInfo.source, packageId: owner?.id, prerequisites: isCore ? "managed-by-pi" : "unknown",
      ...(!eligible.has(t.name) ? { action: "Enable through Pi configuration/current mode; MoAH respects the current restrictions." } : {}),
    };
  });
  for (const command of commands) {
    const kind = command.source === "skill" ? "skill" : command.source === "prompt" ? "prompt" : "command";
    const source = command.sourceInfo?.path ?? command.source;
    const owner = packages.find(p => ownsSource(p, source));
    registry.push({ id: `${kind}:${encodeURIComponent(source)}:${command.name}`, name: `/${command.name}`,
      description: command.description ?? `Pi ${kind}: /${command.name}`, kind, execution: "native", availability: "available",
      activation: kind === "skill" ? "read-skill" : "pi-command", source, packageId: owner?.id, prerequisites: "managed-by-pi",
      action: kind === "skill" ? `Read ${source} to use this skill, or invoke /${command.name} through Pi.` : `Invoke /${command.name} through Pi. This is not a model-callable tool.`,
    });
  }
  for (const pkg of packages) {
    const observed = registry.some(c => c.packageId === pkg.id);
    registry.push({ id: `package:${pkg.id}`, name: pkg.id, description: pkg.reason, kind: "package",
      execution: pkg.mode === "stream" ? "stream" : "native",
      availability: pkg.mode === "unavailable" ? "unavailable" : observed ? "available" : "unknown",
      activation: "native", source: pkg.nativeSource, packageId: pkg.id, prerequisites: "unknown",
      action: pkg.mode === "unavailable" ? "Fix installation/configuration and rebuild the index." : "Package lifecycle and any hooks, services, providers or UI remain managed by Pi. Registration does not verify remote credentials.",
    });
    for (const path of pkg.resources.themes) registry.push({ id: `theme:${encodeURIComponent(path)}`, name: path.split(/[\\/]/).pop()!,
      description: "Theme declared by an installed Pi package", kind: "theme", execution: "native", availability: "unknown",
      activation: "native", source: path, packageId: pkg.id, prerequisites: "managed-by-pi", action: "Select through Pi settings; this is not a tool." });
  }
  return registry.sort((a, b) => a.id.localeCompare(b.id));
}

export function capabilityCard(c: Capability, maxCharacters: number) {
  const text = c.description.replace(/\s+/g, " ").trim();
  return { id: c.id, name: c.name, description: text.length > maxCharacters ? text.slice(0, maxCharacters - 1) + "…" : text,
    kind: c.kind, execution: c.execution, availability: c.availability, activation: c.activation,
    ...(c.action ? { action: c.action } : {}) };
}
