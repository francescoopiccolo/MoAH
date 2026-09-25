import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readConfig, writeJson, defaultConfig } from "./config.js";
import { buildCatalog, readCatalog, nativeArguments } from "./catalog.js";
import { ApiToolRouter } from "./router.js";
import { createMoahExtension } from "./pi-extension.js";
import { measurePreparation } from "./workflow.js";
import { catalogForRouter, readOfficialCatalog } from "./official-catalog.js";
import { runSuite } from "./runner.js";
import { identitySummary } from "./identity.js";
import { ensureLangSmithDataset, runLangSmithExperiment } from "./langsmith-eval.js";
import {
  applySetupEnvironment,
  applySetupToConfig,
  codingModelArguments,
  readSetupSettings,
  runSetup,
} from "./setup.js";
import type { Config } from "./types.js";

async function piMain(args: string[], options?: Record<string, unknown>, useMoahTheme = false): Promise<void> {
  if (process.env.PI_CODING_AGENT_DIR && !process.env.MOAH_CODING_AGENT_DIR) {
    process.env.MOAH_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
  }
  if (process.env.PI_CODING_AGENT_SESSION_DIR && !process.env.MOAH_CODING_AGENT_SESSION_DIR) {
    process.env.MOAH_CODING_AGENT_SESSION_DIR = process.env.PI_CODING_AGENT_SESSION_DIR;
  }
  const runtime = await import("./vendor/pi-runtime/index.js");
  let runtimeArgs = args;
  if (useMoahTheme && !args.includes("--no-themes")) {
    const candidates = [new URL("../data/moah-theme.json", import.meta.url), new URL("../../data/moah-theme.json", import.meta.url)];
    const themePath = candidates.map(url => fileURLToPath(url)).find(path => existsSync(path));
    if (!themePath) throw new Error("MoAH terminal theme not found");
    const selectDefault = !args.includes("--use-theme");
    runtimeArgs = ["--theme", themePath, ...(selectDefault ? ["--use-theme", "moah"] : []), ...args];
  }
  return runtime.main(runtimeArgs, options as any);
}

function repoProfilesDir(): string {
  const candidates = [
    new URL("../benchmarks/profiles/", import.meta.url),
    new URL("../../benchmarks/profiles/", import.meta.url),
  ].map(url => fileURLToPath(url));
  return candidates.find(dir => existsSync(dir)) ?? candidates[0];
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command = "start", ...rest] = args;
  const cwd = process.cwd();
  const configPath = resolve(cwd, "moah.config.json");

  if (["help", "--help", "-h"].includes(command)) {
    console.log(`MoAH — coding agent with automatic tool routing

  moah                   Set up if needed, then start MoAH
  setup                  Configure coding and router models again
  init                   Create moah.config.json
  index                  Index local Pi capabilities and verify the bundled corpus
  route <request>        Test the API router against the bundled catalog
  doctor                 Show runtime/router diagnostics
  about                  Show MoAH and bundled engine versions
  catalog                Show indexed packages
  install <source>       Install a Pi package with Pi's package manager
  list                   List installed Pi packages
  config                 Open Pi's package configuration
  update                 Show how to update MoAH
  update --extensions    Update installed Pi extensions
  baseline <profile>     Run a comparison baseline profile
  bench <suite.json>     Run a comparison benchmark suite [--dry-run]
  langsmith dataset <suite.json>          Create/load the LangSmith dataset
  langsmith run <suite.json> <profile>    Run a LangSmith experiment
  pi [runtime arguments] Start MoAH with advanced runtime options
  dense [runtime args]   Start MoAH with every available package loaded natively

Run moah with no arguments for guided setup. Advanced commands remain available
for manual configuration and automated workflows.`);
    return;
  }

  if (command === "init") {
    if (rest.length) throw new Error("Usage: moah init (inside your project)");
    await writeFile(join(cwd, "moah.config.json"), JSON.stringify(defaultConfig(), null, 2) + "\n", { flag: "wx" });
    console.log(`Created moah.config.json. Set ${defaultConfig().router.apiKeyEnv}, then run moah index and moah pi.`);
    return;
  }

  if (command === "about") {
    if (rest.length) throw new Error("Usage: moah about");
    console.log(identitySummary());
    return;
  }

  if (command === "update" && (rest.length === 0 || rest.some(arg => ["--self", "self", "pi", "--all", "--help", "-h"].includes(arg)))) {
    console.log("Update MoAH with your package manager. For npm: npm install -g moah-ai@latest");
    console.log("To update installed extensions only: moah update --extensions");
    return;
  }

  if (["install", "remove", "update", "list", "config"].includes(command)) {
    if (["install", "remove"].includes(command) && rest.length !== 1) throw new Error(`Usage: moah ${command} <Pi source>`);
    await measurePreparation(cwd, `pi-${command}`, () => piMain([command, ...rest, ...(["install", "remove", "config"].includes(command) ? ["-l"] : [])]));
    return;
  }

  if (["start", "setup"].includes(command)) {
    let configuredNow = command === "setup";
    let settings = configuredNow ? await runSetup() : await readSetupSettings();
    if (!settings) {
      settings = await runSetup();
      configuredNow = true;
    }

    const configExists = existsSync(configPath);
    let config = configExists ? await readConfig(configPath) : defaultConfig();
    if (configuredNow || !configExists) {
      config = applySetupToConfig(config, settings);
      await writeJson(configPath, config);
    }
    await applySetupEnvironment(settings);

    console.log("MoAH: preparing project tools...");
    let catalog;
    try {
      catalog = await readCatalog(config, cwd);
    } catch {
      catalog = await buildCatalog(config, cwd);
    }
    const unavailable = catalog.filter(pkg => pkg.mode === "unavailable");
    if (unavailable.length) console.warn(`MoAH: ${unavailable.length} optional capabilities unavailable. Run moah doctor for details.`);
    await piMain(
      [...nativeArguments(catalog), ...codingModelArguments(settings)],
      { extensionFactories: [{ name: "moah", factory: createMoahExtension({ cwd, config, catalog }) }] },
      true,
    );
    return;
  }

  const config = await readConfig(configPath);

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
    if (rest[0] === "update") return main(rest);
    const catalog = await loadCatalog();
    const settings = await readSetupSettings();
    if (settings) await applySetupEnvironment(settings);
    const unavailable = catalog.filter(pkg => pkg.mode === "unavailable");
    if (unavailable.length) console.warn(`MoAH: ${unavailable.length} optional capabilities unavailable. Run moah doctor for details.`);
    await piMain(
      [...nativeArguments(catalog), ...(settings ? codingModelArguments(settings) : []), ...rest],
      { extensionFactories: [{ name: "moah", factory: createMoahExtension({ cwd, config, catalog }) }] },
      true,
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
