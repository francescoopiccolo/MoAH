import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readConfig, stateDir, defaultConfig } from "./config.js";
import { buildCatalog, readCatalog, nativeArguments } from "./catalog.js";
import { ApiToolRouter } from "./router.js";
import { createMoahExtension } from "./pi-extension.js";
import { measurePreparation } from "./workflow.js";
import { catalogForRouter, readOfficialCatalog } from "./official-catalog.js";
import { runSuite } from "./runner.js";
import { ensureLangSmithDataset, runLangSmithExperiment } from "./langsmith-eval.js";
import type { Config } from "./types.js";

async function piMain(args: string[], options?: Record<string, unknown>): Promise<void> {
  const { main } = await import("./vendor/pi-runtime/index.js");
  return main(args, options as any);
}

function repoProfilesDir(): string {
  const candidates = [
    new URL("../benchmarks/profiles/", import.meta.url),
    new URL("../../benchmarks/profiles/", import.meta.url),
  ].map(url => fileURLToPath(url));
  return candidates.find(dir => existsSync(dir)) ?? candidates[0];
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command = "help", ...rest] = args;
  const cwd = process.cwd();

  if (["help", "--help", "-h"].includes(command)) {
    console.log(`MoAH — lean Pi fork with an API tool router

  init                   Create moah.config.json
  index                  Index local Pi capabilities and verify the bundled corpus
  route <request>        Test the API router against the bundled catalog
  doctor                 Show runtime/router diagnostics
  catalog                Show indexed packages
  install <source>       Install a Pi package with Pi's package manager
  list                   List installed Pi packages
  config                 Open Pi's package configuration
  baseline <profile>     Run a comparison baseline profile
  bench <suite.json>     Run a comparison benchmark suite [--dry-run]
  langsmith dataset <suite.json>          Create/load the LangSmith dataset
  langsmith run <suite.json> <profile>    Run a LangSmith experiment
  pi [Pi arguments]      Start Pi with MoAH
  dense [Pi arguments]   Start Pi with every available package loaded natively

Set ${defaultConfig().router.apiKeyEnv} for the router model. The main agent
model and login remain managed by Pi.`);
    return;
  }

  if (command === "init") {
    if (rest.length) throw new Error("Usage: moah init (inside your project)");
    await writeFile(join(cwd, "moah.config.json"), JSON.stringify(defaultConfig(), null, 2) + "\n", { flag: "wx" });
    console.log(`Created moah.config.json. Set ${defaultConfig().router.apiKeyEnv}, then run moah index and moah pi.`);
    return;
  }

  if (["install", "remove", "update", "list", "config"].includes(command)) {
    if (["install", "remove"].includes(command) && rest.length !== 1) throw new Error(`Usage: moah ${command} <Pi source>`);
    await measurePreparation(cwd, `pi-${command}`, () => piMain([command, ...rest, ...(["install", "remove", "config"].includes(command) ? ["-l"] : [])]));
    return;
  }

  const config = await readConfig(resolve(cwd, "moah.config.json"));

  if (command === "index") {
    const catalog = await measurePreparation(cwd, "index", () => buildCatalog(config, cwd));
    console.log(`Indexed ${catalog.length} package(s).`);
    for (const pkg of catalog) console.log(`${pkg.id} [${pkg.mode}]: ${pkg.reason}`);
    return;
  }

  if (command === "bench") {
    if (!rest[0]) throw new Error("Usage: moah bench <suite.json> [--dry-run]");
    const dryRun = rest.includes("--dry-run");
    const suitePath = rest.filter(arg => arg !== "--dry-run")[0];
    const results = await runSuite(suitePath, cwd, dryRun);
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (command === "langsmith") {
    const [subcommand, suitePath, profile] = rest;
    if (subcommand === "dataset") {
      if (!suitePath) throw new Error("Usage: moah langsmith dataset <suite.json>");
      console.log(JSON.stringify({ datasetName: await ensureLangSmithDataset(suitePath) }, null, 2));
      return;
    }
    if (subcommand === "run") {
      if (!suitePath || !profile) throw new Error("Usage: moah langsmith run <suite.json> <profile>");
      console.log(JSON.stringify(await runLangSmithExperiment(suitePath, cwd, profile), null, 2));
      return;
    }
    throw new Error("Usage: moah langsmith <dataset|run> ...");
  }

  if (command === "doctor") {
    const report: Record<string, unknown> = {
      node: process.version,
      pi: "0.85.1",
      router: {
        ...config.router,
        apiKeyPresent: Boolean(process.env[config.router.apiKeyEnv]),
      },
      catalog: undefined as unknown,
    };
    try {
      report.catalog = (await readCatalog(config, cwd)).map(pkg => ({
        id: pkg.id,
        mode: pkg.mode,
        resident: pkg.nativeResident,
        reason: pkg.reason,
      }));
    } catch (error) {
      report.catalogError = String(error);
      process.exitCode = 1;
    }
    report.externalTools = Object.fromEntries(["sh"].map(name => {
      const check = spawnSync(name, ["--version"], { windowsHide: true, timeout: 5000, encoding: "utf8" });
      return [name, { available: !check.error && check.status === 0 }];
    }));
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const loadCatalog = async () => {
    try {
      return await readCatalog(config, cwd);
    } catch {
      return await buildCatalog(config, cwd);
    }
  };

  if (command === "catalog") {
    const catalog = await loadCatalog();
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }

  if (command === "baseline") {
    if (!rest[0]) throw new Error("Usage: moah baseline <profile> [Pi arguments]");
    const profileName = rest[0];
    const piArgs = rest.slice(1);
    const localProfilePath = join(cwd, "benchmarks", "profiles", `${profileName}.json`);
    const bundledProfilePath = join(repoProfilesDir(), `${profileName}.json`);
    const profilePath = profileName.endsWith(".json")
      ? resolve(profileName)
      : [localProfilePath, bundledProfilePath].find(path => existsSync(path))
        ?? localProfilePath;
    const profile = JSON.parse(await readFile(profilePath, "utf8")) as {
      name: string;
      mode: "pi-default" | "pi-full" | "moah-auto" | "moah-suggest" | "moah-oracle";
    };
    if (!["pi-default", "pi-full", "moah-auto", "moah-suggest", "moah-oracle"].includes(profile.mode)) {
      throw new Error(`Unknown baseline mode: ${profile.mode}`);
    }

    console.warn(`MoAH baseline: ${profile.name} (${profile.mode})`);

    if (profile.mode === "pi-default") {
      await piMain(piArgs);
      return;
    }
    const catalog = await loadCatalog();
    if (profile.mode === "pi-full") {
      await piMain([...nativeArguments(catalog, true), ...piArgs]);
      return;
    }

    const routerMode = profile.mode === "moah-auto"
      ? "auto"
      : profile.mode === "moah-suggest"
        ? "suggest"
        : "oracle";
    const baselineConfig = {
      ...config,
      router: {
        ...config.router,
        enabled: true,
        mode: routerMode as Config["router"]["mode"],
      },
    };
    await piMain(
      [...nativeArguments(catalog), ...piArgs],
      { extensionFactories: [{ name: "moah", factory: createMoahExtension({ cwd, config: baselineConfig, catalog }) }] },
    );
    return;
  }

  if (command === "route") {
    if (!rest.length) throw new Error("Usage: moah route <request>");
    const officialCatalog = await readOfficialCatalog();
    const candidates = catalogForRouter(officialCatalog, config.router.baseTools);
    const router = new ApiToolRouter(config.router);
    console.log(JSON.stringify(await router.route(rest.join(" "), candidates), null, 2));
    return;
  }

  if (command === "dense") {
    const catalog = await loadCatalog();
    await piMain([...nativeArguments(catalog, true), ...rest]);
    return;
  }

  if (command === "pi") {
    const catalog = await loadCatalog();
    for (const pkg of catalog.filter(pkg => pkg.mode === "unavailable")) {
      console.warn(`MoAH ${pkg.id}: ${pkg.reason}`);
    }
    await piMain(
      [...nativeArguments(catalog), ...rest],
      { extensionFactories: [{ name: "moah", factory: createMoahExtension({ cwd, config, catalog }) }] },
    );
    return;
  }

  throw new Error(`Unknown command: ${command}. Run moah help`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
