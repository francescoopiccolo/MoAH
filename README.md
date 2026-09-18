# MoAH

MoAH is a thin fork of **Pi Agent**. It keeps Pi's agent loop, streaming,
sessions, providers and login unchanged, and adds one small layer: an API
router chooses which optional tools to activate for each user message.

No local embeddings, no semantic search, no public package crawler, no worker
process orchestration. The bundled official Pi extensions live on disk; the
router receives only compact one-line tool descriptions, not system prompts or
agent-loop instructions.

See [REPORT.md](REPORT.md) for the current comparison against Pi and OpenCode.

## Flow

```text
user message
   -> MoAH builds a compact candidate list from Pi's registered tools
   -> an API model returns a JSON list of tool names
   -> Pi activates base tools + selected tools
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
  "packages": []
}
```

`baseTools` are always active when Pi exposes them. Optional tools are
discovered from Pi's `getAllTools()`, so a user-installed native Pi package can
be routed the same way once Pi loads it.

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

| profile | success | latency | cost |
|---|---:|---:|---:|
| pi-default | 100% | 8.18s | $0.00010 |
| pi-full | 97.5% | 8.61s | $0.00020 |
| moah-auto | 100% | 10.60s | $0.00021 |
| moah-suggest | 100% | 11.90s | $0.00020 |
| moah-oracle | 100% | 8.95s | $0.00012 |
| opencode | 76.9% | 10.28s | $0.00183 |

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
MoAH routing is not active in that mode.
