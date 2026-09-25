import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Config } from "./types.js";

type ProviderId = "openai" | "anthropic" | "google" | "openrouter";
type RouterProviderId = "openai" | "openrouter";

export interface SetupSettings {
  schema: 1;
  coding: {
    provider: ProviderId;
    model: string;
    apiKeyEnv: string;
  };
  router: {
    provider: RouterProviderId;
    model: string;
    sourceApiKeyEnv: string;
  };
}

type StoredCredentials = {
  schema: 1;
  values: Record<string, string>;
};

type ProviderDefinition = {
  id: ProviderId;
  label: string;
  apiKeyEnv: string;
  baseUrl?: string;
  models: Array<{ id: string; label: string; description: string }>;
};

type Choice<T extends string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: string;
};

const MOAH_DIR = join(homedir(), ".moah");
const SETTINGS_PATH = join(MOAH_DIR, "settings.json");
const CREDENTIALS_PATH = join(MOAH_DIR, "credentials.json");

const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Balanced for everyday coding" },
      { id: "gpt-6-astra", label: "GPT-6 Astra", description: "Most capable" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Fast and economical" },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Balanced for coding" },
      { id: "claude-opus-5", label: "Claude Opus 5", description: "Most capable" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast and economical" },
    ],
  },
  google: {
    id: "google",
    label: "Google Gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "Most capable" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "Fast and economical" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Stable general-purpose model" },
    ],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "~openai/gpt-latest", label: "Latest OpenAI model", description: "OpenRouter rolling alias" },
      { id: "~anthropic/claude-sonnet-latest", label: "Latest Claude Sonnet", description: "OpenRouter rolling alias" },
      { id: "~google/gemini-pro-latest", label: "Latest Gemini Pro", description: "OpenRouter rolling alias" },
    ],
  },
};

function isSetupSettings(value: any): value is SetupSettings {
  return value?.schema === 1 &&
    PROVIDERS[value?.coding?.provider as ProviderId] !== undefined &&
    typeof value?.coding?.model === "string" && value.coding.model.length > 0 &&
    typeof value?.coding?.apiKeyEnv === "string" && value.coding.apiKeyEnv.length > 0 &&
    ["openai", "openrouter"].includes(value?.router?.provider) &&
    typeof value?.router?.model === "string" && value.router.model.length > 0 &&
    typeof value?.router?.sourceApiKeyEnv === "string" && value.router.sourceApiKeyEnv.length > 0;
}

async function question(message: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback ? ` [${fallback}]` : "";
    const answer = (await rl.question(`${message}${suffix}: `)).trim();
    return answer || fallback || "";
  } finally {
    rl.close();
  }
}

async function choose<T extends string>(heading: string, choices: Choice<T>[], defaultIndex = 0): Promise<T> {
  console.log(`\n${heading}`);
  choices.forEach((choice, index) => {
    const detail = choice.disabled ?? choice.description;
    console.log(`  ${index + 1}. ${choice.label}${detail ? ` — ${detail}` : ""}`);
  });

  for (;;) {
    const answer = await question("Select", String(defaultIndex + 1));
    const index = Number(answer) - 1;
    const choice = choices[index];
    if (!choice || !Number.isInteger(index)) {
      console.log(`Enter a number from 1 to ${choices.length}.`);
      continue;
    }
    if (choice.disabled) {
      console.log(choice.disabled);
      continue;
    }
    return choice.value;
  }
}

async function yesNo(message: string, defaultYes = true): Promise<boolean> {
  for (;;) {
    const answer = (await question(`${message} ${defaultYes ? "[Y/n]" : "[y/N]"}`)).toLowerCase();
    if (!answer) return defaultYes;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.log("Enter y or n.");
  }
}

async function secret(message: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) return question(message);
  process.stdout.write(`${message}: `);
  return new Promise((resolve, reject) => {
    let value = "";
    const input = process.stdin;
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Setup cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          process.stdout.write("*");
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readCredentials(): Promise<StoredCredentials> {
  try {
    const parsed = JSON.parse(await readFile(CREDENTIALS_PATH, "utf8"));
    if (parsed?.schema === 1 && parsed.values && typeof parsed.values === "object") return parsed;
    throw new Error(`Invalid MoAH credentials file: ${CREDENTIALS_PATH}`);
  } catch (error: any) {
    if (error.code === "ENOENT") return { schema: 1, values: {} };
    throw error;
  }
}

async function writeUserFile(path: string, value: unknown): Promise<void> {
  await mkdir(MOAH_DIR, { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

async function ensureCredential(provider: ProviderDefinition, credentials: StoredCredentials): Promise<string> {
  const envValue = process.env[provider.apiKeyEnv];
  if (envValue && await yesNo(`Use ${provider.apiKeyEnv} from your environment?`)) return provider.apiKeyEnv;

  const stored = credentials.values[provider.apiKeyEnv];
  if (stored && await yesNo(`Use the saved ${provider.label} API key?`)) {
    process.env[provider.apiKeyEnv] = stored;
    return provider.apiKeyEnv;
  }

  for (;;) {
    const key = await secret(`${provider.label} API key`);
    if (!key) {
      console.log("An API key is required.");
      continue;
    }
    credentials.values[provider.apiKeyEnv] = key;
    process.env[provider.apiKeyEnv] = key;
    return provider.apiKeyEnv;
  }
}

async function chooseModel(provider: ProviderDefinition, heading: string): Promise<string> {
  const custom = "__custom__";
  const selected = await choose(heading, [
    ...provider.models.map((model, index) => ({
      value: model.id,
      label: model.label,
      description: `${model.id}${index === 0 ? " · recommended" : ""}`,
    })),
    { value: custom, label: "Enter a model ID", description: "Use any model supported by this provider" },
  ]);
  if (selected !== custom) return selected;
  for (;;) {
    const id = await question("Model ID");
    if (id) return id;
    console.log("A model ID is required.");
  }
}

export async function readSetupSettings(): Promise<SetupSettings | undefined> {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
    if (!isSetupSettings(parsed)) throw new Error(`Invalid MoAH settings file: ${SETTINGS_PATH}`);
    return parsed;
  } catch (error: any) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function applySetupEnvironment(settings: SetupSettings): Promise<void> {
  const credentials = await readCredentials();
  for (const [name, value] of Object.entries(credentials.values)) {
    if (!process.env[name]) process.env[name] = value;
  }
  const routerKey = process.env[settings.router.sourceApiKeyEnv];
  if (!routerKey) {
    throw new Error(`Missing ${settings.router.sourceApiKeyEnv}. Run \`moah setup\` to configure it.`);
  }
  process.env.MOAH_ROUTER_API_KEY = routerKey;
}

export function applySetupToConfig(config: Config, settings: SetupSettings): Config {
  const routerProvider = PROVIDERS[settings.router.provider];
  return {
    ...config,
    router: {
      ...config.router,
      enabled: true,
      mode: "auto",
      baseUrl: routerProvider.baseUrl!,
      model: settings.router.model,
      apiKeyEnv: "MOAH_ROUTER_API_KEY",
    },
  };
}

export function codingModelArguments(settings: SetupSettings): string[] {
  return ["--provider", settings.coding.provider, "--model", settings.coding.model];
}

export async function runSetup(): Promise<SetupSettings> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive setup requires a terminal. Use `moah init` for manual configuration.");
  }

  console.log("\nMoAH");
  console.log("Configure your coding and router models. This takes about a minute.");
  console.log("API keys are stored in ~/.moah and are never written to your project.");

  const credentials = await readCredentials();
  const codingProviderId = await choose<ProviderId>("Coding provider", [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "google", label: "Google Gemini" },
    { value: "openrouter", label: "OpenRouter" },
  ]);
  const codingProvider = PROVIDERS[codingProviderId];
  const codingModel = await chooseModel(codingProvider, "Coding model");
  const codingApiKeyEnv = await ensureCredential(codingProvider, credentials);

  const sameSupported = codingProviderId === "openai" || codingProviderId === "openrouter";
  const routerChoice = await choose<"same" | RouterProviderId>(
    "Router model\nOpenAI-compatible providers are recommended.",
    [
      {
        value: "same",
        label: "Use the same coding model",
        ...(sameSupported ? { description: "Reuse the model and API key" } : {
          disabled: "Unavailable because this coding provider is not OpenAI-compatible",
        }),
      },
      { value: "openai", label: "OpenAI" },
      { value: "openrouter", label: "OpenRouter" },
    ],
  );

  let routerProvider: RouterProviderId;
  let routerModel: string;
  let sourceApiKeyEnv: string;
  if (routerChoice === "same") {
    routerProvider = codingProviderId as RouterProviderId;
    routerModel = codingModel;
    sourceApiKeyEnv = codingApiKeyEnv;
  } else {
    routerProvider = routerChoice;
    const provider = PROVIDERS[routerProvider];
    routerModel = await chooseModel(provider, `${provider.label} router model`);
    sourceApiKeyEnv = provider.id === codingProvider.id
      ? codingApiKeyEnv
      : await ensureCredential(provider, credentials);
  }

  const settings: SetupSettings = {
    schema: 1,
    coding: { provider: codingProviderId, model: codingModel, apiKeyEnv: codingApiKeyEnv },
    router: { provider: routerProvider, model: routerModel, sourceApiKeyEnv },
  };
  await writeUserFile(CREDENTIALS_PATH, credentials);
  await writeUserFile(SETTINGS_PATH, settings);
  await applySetupEnvironment(settings);

  console.log("\nSetup complete.");
  console.log(`Coding model: ${settings.coding.provider}/${settings.coding.model}`);
  console.log(`Router model: ${settings.router.provider}/${settings.router.model}\n`);
  return settings;
}
