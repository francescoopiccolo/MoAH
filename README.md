# MoAH

MoAH is a **standalone coding-agent harness derived from Pi**, with an
automatic API tool router and SSD-backed sparse package residency.

[Website and installation options](https://francescoopiccolo.github.io/moah-website/)

You write the prompt. MoAH decides which optional tools the next phase needs,
activates them, and lets Pi stream the answer. The developer does not need to
search for tools, install them, or reason about which ones to put into the
harness.

The bundled official Pi extensions stay on disk. The router sees only compact
one-line descriptions, not internal system prompts or agent-loop instructions.
Optional stateless packages can also stay physically on disk and be loaded
asynchronously into bounded warm workers after the router selects them.

See [REPORT-PREOPTIMIZATION.md](REPORT-PREOPTIMIZATION.md) for the frozen
pre-optimization benchmark and the full architectural explanation.

## Flow

```text
user message
   -> MoAH builds a compact candidate list from native tools plus
      indexed streamable package metadata
   -> an API model returns a JSON list of tool names
   -> Pi activates base tools + selected tools
   -> selected streamable packages start warming asynchronously
   -> the main agent streams its answer normally
```

`router.mode` controls the policy:

- `auto`: MoAH applies the router's choice automatically.
- `suggest`: MoAH only adds a short suggestion to the user message and leaves
  the current tool set unchanged; the agent can call `moah_select` if needed.

## Install and run

Requirements: Node >= 22.19 and npm. The forked Pi runtime is bundled with
MoAH; Pi does not need to be installed or started separately.

```sh
npm install -g moah-ai
```

Other package managers:

```sh
pnpm add -g moah-ai@0.1.3
bun add -g moah-ai
```

All methods run MoAH on Node.js >=22.19. If pnpm's global bin directory has
not been configured, run `pnpm setup` and open a new terminal first.
The [website](https://francescoopiccolo.github.io/moah-website/) also provides
PowerShell (Windows) and curl (macOS/Linux) installers. Those require Node.js
and npm already installed, use a user directory, and configure the user's PATH.
Their source and installation checks live in the separate
[website repository](https://github.com/francescoopiccolo/moah-website).

Then, from the project you want to work on:

```sh
cd /path/to/your/project
moah
```

The first launch asks for the coding provider, coding model, API key, and router
model. Router choices are:

```text
Router model
OpenAI-compatible providers are recommended.

1. Use the same coding model
2. OpenAI
3. OpenRouter
```

`Use the same coding model` is available when the coding provider is OpenAI or
OpenRouter. Direct Anthropic and Google Gemini models require a separate OpenAI
or OpenRouter router.

API keys can come from the provider's standard environment variable or be
entered in a masked prompt. Entered keys are stored in `~/.moah/credentials.json`
inside the user's home directory and are never written to the project. The file
uses user-only permissions on platforms that support POSIX file modes. Model
preferences are stored in `~/.moah/settings.json`.

MoAH then creates `moah.config.json`, indexes the bundled capabilities, and
starts the agent automatically. Later launches use the same `moah` command.

## Configuration

`moah.config.json`:

```json
{
  "baseline": { "enabled": true },
  "router": {
    "enabled": true,
    "mode": "auto",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "MOAH_ROUTER_API_KEY",
    "maxTools": 6,
    "baseTools": ["read", "bash", "powershell", "edit", "write"]
  },
  "streaming": {
    "enabled": true,
    "prefetch": true,
    "cold": false,
    "hotPreload": 0,
    "maxProcesses": 2,
    "residentBudgetMb": 512,
    "idleTtlMs": 120000,
    "loadTimeoutMs": 30000,
    "callTimeoutMs": 120000,
    "estimatedRssMb": 64
  },
  "packages": []
}
```

`baseTools` are always active when Pi exposes them. Optional tools are
discovered from Pi's `getAllTools()` and from indexed streamable package
metadata. A user-installed package can therefore be routed even when its
implementation is still on disk.

Streamable packages must opt in explicitly. For example:

```json
{
  "packages": [
    {
      "id": "my-stateless-tool",
      "entry": "extensions/my-stateless-tool.ts",
      "mode": "stream",
      "stateless": true,
      "workerSdk": "lazy"
    }
  ]
}
```

Streaming hosts one stateless package per child process. Killing that worker is
the physical unload boundary. Packages that use lifecycle hooks, commands,
custom rendering, stateful Pi APIs, or a directory package root stay native.
Set `streaming.cold: true` to disable popularity preload and speculative
prefetch for controlled cold-path tests; demand loading still works.

## Default tools

Base tools always active:

```text
read
bash
powershell
edit
write
```

Official optional tools available to the router:

```text
grep
find
ls
subagent
todo
question
questionnaire
structured_output
rg
reload_runtime
```

## Validated efficiency baseline

This is the frozen pre-optimization baseline for MoAH v1.

| system | fresh tokens vs Pi | processed tokens vs Pi | E2E median |
|---|---:|---:|---:|
| Pi Vanilla | 1.00x | 1.00x | ~4.9 s |
| MoAH Streamed Prefetch | 1.44x | 1.30x | ~6.1 s |
| OpenCode | 3.64x | 6.96x | ~11.2 s |

MoAH automatically:

1. reads the user prompt;
2. asks a small API router to select only the useful optional tools;
3. activates those schemas;
4. warms selected streamable packages asynchronously;
5. leaves the main model a compact context instead of every known tool.

Compared with OpenCode on the tested deterministic tasks, MoAH saved:

```text
~60% fresh tokens
~81% processed tokens
```

while adding over Pi:

```text
~44% fresh-token overhead
~30% processed-token overhead
```

The largest measured first-request difference versus OpenCode came from:

```text
~62% tool schemas
~38% system/harness instructions
```

The important advantage is automation plus context efficiency: the router does
the manual tool-selection work for the developer and MoAH does not put every
available tool into the main-model context.

See [REPORT-PREOPTIMIZATION.md](REPORT-PREOPTIMIZATION.md) for tasks,
limitations, next phases, and the full methodology.

## Clean SSD-backed streaming baseline

The experimental streamed-artifact path is now runtime-independent and does
not load the full upstream Pi coding-agent runtime.

Clean real `rg` workload, `openrouter/openai/gpt-4o-mini`:

```text
Demand:
  load time:        958 ms
  foreground wait:  961 ms

Prefetch:
  load time:        758 ms median
  foreground wait:  1.6 ms median
  hidden fraction:  99.8% median
```

Clean prebuilt artifacts:

```text
hello              ~1031 ms import / ~119 MB worker RSS
structured-output  ~1115 ms import / ~117 MB worker RSS
rg                 ~1041 ms import / ~119 MB worker RSS
```

Process-tree RAM comparison:

```text
Native    startup/min 92.0 MB / peak 134.9 MB
Demand    startup/min 67.0 MB / peak 163.2 MB
Prefetch  startup/min 65.4 MB / peak 178.9 MB
```

Streaming lowers startup/idle memory but currently adds peak memory during
cold worker use. Warm reuse is near-native.

See [STREAMING-BASELINE.md](STREAMING-BASELINE.md).

## Controls in Pi

- `/moah` — status, active tools and last router decision.
- `/moah dense` — expose every optional tool.
- `/moah sparse` — release every optional tool.
- `moah_select({"tools": [...]})` — manual selection/deselection inside the
  conversation.

## Commands

```sh
moah
moah setup
moah init
moah index
moah route "Search the web"
moah doctor
moah catalog
moah bench benchmarks/lean-smoke.json --dry-run
moah bench benchmarks/lean-smoke.json
moah pi
moah dense
```

`moah setup` runs the model and API-key setup again. `init`, `index`, and `pi`
remain available for manual and automated workflows.

`moah dense` starts original Pi with every available package loaded natively;
MoAH routing is not active in that mode. It remains the control condition for
streaming benchmarks.
