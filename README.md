# MoAH — Mixture of Agent Harness

**Keep Pi's agent. Let its model select optional tools for the current phase. Load compatible packages when needed, and release their processes afterwards.**

MoAH is a research implementation on **original Pi 0.85.1**. Sessions, editing,
providers, authentication and the agent loop remain Pi's. The model connected to
Pi chooses capabilities from a compact catalog through `moah_activate`.
A second language model is not required.

**[Technical report](paper/MoAH.md)** · **[Measurements](paper/data/README.md)** · **[Reproduction guide](paper/REPRODUCING.md)** · **[Research history in Italian](README.it.md)**

## Why this exists

A small harness keeps context lean, but discovering and configuring extensions
takes work. MoAH explores broad discoverability with a small active tool set,
selected by the agent as work changes phase. Reducing developer tool-management
effort is a hypothesis, not an already measured result.

Pi already supports dynamic registration and activation within a session. MoAH
adds a selection policy and process lifecycle using those extension points.
It discovers the complete public Pi package index but **does not autonomously
install/uninstall every package**. Stateful, UI and hook-based extensions retain
Pi's native lifecycle instead of being discarded.

```text
User request → original Pi + your model + compact catalog
                    ↓
          moah_activate([webfetch])
                    ↓ next-turn activation
          upstream worker loads; webfetch runs
                    ↓ research complete
             moah_activate([])
                    ↓ optional schema removed; idle worker released
              Pi core tools continue coding
```

Selection **replaces** the previous optional set. New user prompts reset it by
default. Useful results and conversation history remain. The compact catalog is
one transient message rather than repeated saved history. Equivalent repeated
control requests are bounded to prevent selection/search loops.

Installed code lives on the filesystem; the operating system may serve it from
RAM. This is not model-weight streaming. Physical SSD-bandwidth benefits have
not been measured.

## Installation

**Research preview.** Locally validated on Windows 11 / Node 24. Requires Node
**22.19+** and npm. Other platforms need their own validation. Python and `sh`
are needed only for the bundled upstream web tools.

### From source

```sh
git clone https://github.com/francescoopiccolo/MoAH.git
cd MoAH
npm ci
npm run build
npm test
npm link
```

`npm link` makes the local `moah` command available. Alternatively use
`node /absolute/path/to/MoAH/bin/moah.mjs` instead of `moah` below; quote paths
containing spaces. Switch to **the project the agent should work on**:

```sh
cd /path/to/your/project
moah init
moah index
moah pi
```

`init` refuses to overwrite existing configuration. Portable defaults use CPU
and disable optional semantic retrieval; ordinary selection needs no embedding
download. Inside Pi use `/login` and `/model`. OpenRouter is one option; try any
Pi-supported model with reliable tool calling. Provider charges are yours.
Do not store credentials in this repository or in `moah.config.json`.

The root checked-in configuration preserves historical DirectML research
settings. Prefer `moah init` in your project. The older `scripts/run.ps1` operates
in the checkout, unlike the portable `moah` command.

### Compiled release

Download the tarball from [v0.1.0](https://github.com/francescoopiccolo/MoAH/releases/tag/v0.1.0):

```sh
npm install -g ./moah-pi-0.1.0.tgz
cd /path/to/your/project
moah init
moah index
moah pi
```

npm fetches dependencies; this is not an offline bundle. There is no npm-registry
publication to install by the name `moah-pi` alone.
For the exact locked dependency graph, use the source checkout and `npm ci`;
tarball installation can resolve newer compatible transitive dependencies.

### Web-tool prerequisites

Create a virtual environment in the target project:

```sh
python -m venv .moah/venv
```

Windows:

```powershell
.\.moah\venv\Scripts\python.exe -m pip install ddgr==2.2 pypandoc_binary==1.17
```

macOS/Linux:

```sh
.moah/venv/bin/python -m pip install ddgr==2.2 pypandoc_binary==1.17
```

Provide `sh` on PATH. On Windows install Git for Windows; the launcher also
checks its standard Program Files location. `moah` adds the project's virtual
environment and Pandoc directory to its child-process PATH.

```sh
moah doctor
moah demo fetch https://example.com/
moah demo search "Pi agent extensions"
```

These demos execute upstream tools without an LLM. They still require network
access and the external tools/services used by the upstream package.

## Complete discovery, selective execution

```sh
moah catalog-sync
moah catalog-search "browser"
moah catalog-search "browser" --offset 40
moah catalog
```

`catalog-sync` fetches all public Pi listing pages into an offline metadata
snapshot. The research capture contained **5,513 packages / 111 pages** on
15 September 2026; see [provenance](paper/data/catalog-provenance.json).
These are not 5,513 installed tools. Counts change, and a new capture will have
a different hash.

`moah_discover` browses installed capabilities, or public metadata with
`scope: "public"`. Tools, slash commands, skills, prompts, themes and packages
retain their actual type. Discovery does not prove runtime credentials or
turn a command into a callable tool.

Use Pi's own package manager through the CLI:

```sh
moah install npm:@scope/package@1.2.3
moah list
moah config
moah remove npm:@scope/package@1.2.3
```

New packages initially follow native Pi behavior. Use Pi's reload/startup
workflow as appropriate; installing a package does not guarantee activation in
the running session. Tools already registered can be selected within the same
conversation without uninstalling their packages.

To stream a tested stateless package, install an exact version, append an entry
like this to `packages` in `moah.config.json`, and run `moah index`:

```json
{
  "id": "my-tools",
  "package": "@scope/package",
  "version": "1.2.3",
  "entry": "index.ts",
  "stateless": true,
  "mode": "auto"
}
```

Unsupported registration APIs trigger native fallback. Stateless declarations
are compatibility assertions, not proofs. Hooks, UI, state and persistent
services need native execution unless adapted and tested. Missing packages are
reported as unavailable. The rich benchmark preserves all seven configured
extensions, producing nine active native Pi tools; not every extension adds a tool.

## Settings and controls

| Setting | Portable default | Meaning |
| --- | --- | --- |
| `selection.maxActiveTools` | 6 | Optional tools beyond preserved tools and MoAH controls |
| `selection.catalogPageSize` | 40 | First page; remaining entries stay searchable |
| `selection.descriptionCharacters` | 200 | Compact description length |
| `selection.resetOnPrompt` | true | Reset optional selection for a new user request |
| `selection.releaseInactive` | true | Release unused workers after the current batch |
| `cache.maxProcesses` | 2 | Worker cache limit |
| `cache.residentBudgetMb` | 768 | Observed worker RSS budget, not a hard memory cap |
| `cache.idleTtlMs` | 120000 | Idle-worker expiry |
| `router.enabled` | false | Optional semantic discovery through local E5 |

For semantic retrieval set `router.enabled: true`, choose a supported backend
(`cpu` is the portable option), then run `moah setup` to download the model.
E5 ranks results only when requested; the main Pi model selects the active set.
The optional model weights are not commit-pinned in v0.1.0.

Inside Pi: `/moah` shows state, `/moah catalog` snapshots capabilities,
`/moah dense` exposes eligible tools, and `/moah sparse` clears the optional set.
The **shell** command `moah dense` instead launches original Pi with the same
packages loaded natively, without MoAH's selection layer.

Pi restrictions apply. An explicit `--tools` allowlist must include
`moah_activate`, `moah_discover` and desired optional tools. `--exclude-tools`
and `--no-tools` are respected.

## Evidence, including negative results

The [paper](paper/MoAH.md) reports **24 real-model attempts: 22 correct artifacts,
21 strict clean runs**, with no timeout or repeat-control pause in those cohorts.
There are only two tasks and one or two repetitions per condition.

- Active schemas shrink, but extra calls and caching can outweigh those savings.
- Controlled streaming core-phase mean working set was **33.9% below Pi**;
  its sampled peak was **54.5% higher**.
- Real web tasks frequently cost more with MoAH. There is no demonstrated
  general cost/latency advantage and no measured OpenCode comparison.
- Lower developer discovery/configuration effort still requires a user study.

![Controlled memory comparison](paper/figures/controlled-memory.png)

## Reproduce

From the checkout:

```sh
npm run check
npm test
python -m pip install -r paper/requirements.txt
python paper/figures.py
```

Figures require no API key. [The reproduction guide](paper/REPRODUCING.md)
distinguishes paid real-model benchmarks from scripted controlled trials.

Workers are lifecycle isolation, **not a security sandbox**. Extensions execute
with your user's privileges. Cancellation cannot undo external side effects;
MoAH does not automatically replay a failed operation. The pinned optional
semantic dependency stack has known advisories: see [SECURITY.md](SECURITY.md).

Original MoAH code is [MIT licensed](LICENSE); dependencies retain their own
licenses. [Third-party attribution](THIRD_PARTY.md).
