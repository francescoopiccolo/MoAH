# MoAH

MoAH is **Pi Agent plus an automatic tool router**.

You write the prompt. MoAH decides which optional tools the next phase needs,
activates them, and lets Pi stream the answer. The developer does not need to
search for tools, install them, or reason about which ones to put into the
harness.

The bundled official Pi extensions stay on disk. The router sees only compact
one-line descriptions, not internal system prompts or agent-loop instructions.
Optional stateless packages can also stay physically on disk and be loaded
asynchronously into bounded warm workers after the router selects them.

See [REPORT.md](REPORT.md) for the full comparison against Pi and OpenCode.

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

Requirements: Node >= 22.19, npm, and a Pi-supported main model.

```sh
git clone https://github.com/francescoopiccolo/MoAH.git
cd MoAH
npm ci
npm run build
npm link
```

In the project you want to work on:

```sh
cd /path/to/your/project
moah init
moah index
moah pi
```

`moah init` writes a portable config. Set `MOAH_ROUTER_API_KEY` for the API
router model. Inside Pi, use `/login` and `/model` as usual for the main agent.

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

## Current comparison

We ran 240 end-to-end benchmark runs: 6 harness profiles, 8 task types, and 5
repetitions per combination.

MoAH is slightly slower than plain Pi, but keeps similar cost and remains far
cheaper than OpenCode, which puts the full tool set into context. In automatic
mode the router selects tools by itself, so the developer does not have to
understand which tools should be added to the harness.

| profile | latency | cost | router tokens |
|---|---:|---:|---:|
| pi-default | 8.18s | $0.00010 | 0 |
| pi-full | 8.61s | $0.00020 | 0 |
| moah-auto | 10.60s | $0.00021 | 262.6 |
| moah-suggest | 11.90s | $0.00020 | 262.9 |
| moah-oracle | 8.95s | $0.00012 | 0 |
| opencode | 10.28s | $0.00183 | 0 |

If manual tool selection time is included in the comparison, MoAH is not merely
close to Pi: it can be orders of magnitude faster from prompt to a useful
working configuration.

See [REPORT.md](REPORT.md) for details and limits.

## Controls in Pi

- `/moah` — status, active tools and last router decision.
- `/moah dense` — expose every optional tool.
- `/moah sparse` — release every optional tool.
- `moah_select({"tools": [...]})` — manual selection/deselection inside the
  conversation.

## Commands

```sh
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

`moah dense` starts original Pi with every available package loaded natively;
MoAH routing is not active in that mode. It remains the control condition for
streaming benchmarks.
