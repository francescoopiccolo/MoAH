#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";

// Activate a project-local web-tool environment without changing the system PATH.
const venv = join(process.cwd(), ".moah", "venv");
const paths = [join(venv, process.platform === "win32" ? "Scripts" : "bin"), join(venv, "Lib", "site-packages", "pypandoc", "files")];
if (existsSync(join(venv, "lib"))) for (const name of readdirSync(join(venv, "lib"))) if (name.startsWith("python")) paths.push(join(venv, "lib", name, "site-packages", "pypandoc", "files"));
if (process.platform === "win32" && process.env.ProgramFiles) paths.push(join(process.env.ProgramFiles, "Git", "usr", "bin"), join(process.env.ProgramFiles, "Git", "bin"));
process.env.PATH = [...paths.filter(existsSync), process.env.PATH ?? ""].join(delimiter);
try {
  const { main } = await import("../dist/src/cli.js");
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
