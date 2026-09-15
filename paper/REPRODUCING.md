# Reproducing the report

## Reanalyze published results (no API, no Pi session)

```sh
python -m venv .paper-venv
# Activate that environment using your shell, then:
python -m pip install -r paper/requirements.txt
python paper/tables.py
python paper/figures.py
```

The table and six SVG/PNG figures use only `paper/data`. They do not access
private raw runs or require provider credentials. Exact font rendering can vary
by platform. The export utility is for maintainers who retain historical runs;
it is not required for reproduction of the figures.

## Prepare new experiments

Use the source checkout, Node 22.19+ (locally tested: Node 24), and the web-tool
prerequisites in the README. The rich profile refers to Pi example extensions
inside this checkout's `node_modules`, so run research commands from the checkout.

```sh
npm ci
npm run build
npm test
node bin/moah.mjs index
node bin/moah.mjs catalog-sync
node bin/moah.mjs demo fetch https://example.com/
```

`index` does not download the optional E5 weights. The primary benchmarks disable
semantic retrieval. `catalog-sync` fetches all current pages, not the exact past
snapshot. The executable/task fixtures and pinned dependencies are public;
the historical public catalog descriptions and private session logs are not.

On Windows, the portable launcher finds Git for Windows in its standard install
location or uses `sh` already on PATH. The legacy `scripts/run.ps1` also detects
the original research host's bundled executables; that path is not a requirement
for other users.

## Controlled experiment (no paid model)

```sh
node bin/moah.mjs bench-controlled --tail-steps 24 --config benchmarks/profiles/rich.json
```

This starts a local scripted SSE provider and executes real tools, including a
network fetch from example.com. It writes a comparison beneath
`.moah/controlled-runs/run-*/`. To calculate aligned phase summaries:

```sh
node dist/scripts/summarize-controlled.js .moah/controlled-runs/run-REPLACE_ME
```

The placeholder must be replaced with the directory printed by the run.
The injected response delays support measurement; its elapsed time is not LLM
latency. Non-Windows runs do not collect the Windows CIM memory metric.
Windows must allow the local sampler script to run under its existing policy.
Monitor startup and CIM errors are recorded as unavailable measurements, not
zero memory. CI initializes CIM before its short-process integration test;
cold sampler startup can miss short-lived processes. MoAH does not change the
machine's execution policy.

## Real-model experiments (provider charges)

First configure your provider using Pi (`node bin/moah.mjs pi`, then `/login`).
Pi also recognizes provider-specific environment credentials. Never commit them.
Inspect a plan before executing:

```sh
node bin/moah.mjs bench benchmarks/rich-real.json --dry-run
node bin/moah.mjs bench benchmarks/rich-real.json
node bin/moah.mjs bench benchmarks/rich-gemini-real.json
node bin/moah.mjs bench benchmarks/intermediate-real.json
```

These suites generate 12, 6 and 6 attempts respectively. A suite can exit nonzero
when an attempt fails; retain its results. Costs, availability and returned model
versions may change. They are not bounded by the historical $0.153 total.
Adjust model/provider fields before starting if those aliases are unavailable.

```sh
node dist/scripts/summarize-real.js .moah/benchmark-runs/run-REPLACE_ME
```

For OpenRouter cost auditing, see `scripts/audit-openrouter.ts`: it uses the same
account's API and generation IDs recorded by the run. Summaries accept an
existing audit but do not invent one if absent. Audit completeness is limited to
IDs found in logs. Provider identifiers in shared logs should be reviewed before
publication.

New runs must stay separate from the historical cohorts. Specify model, endpoint
policy, cache protocol, profile, repetitions, machine and success criteria. The
current suites rotate order, use natural caching and test two prompts per task.
They are not randomized controlled user studies or provider-cache experiments.

## Release checks

```sh
npm run check
npm test
npm pack --pack-destination .moah/releases
npm run test:package -- .moah/releases/moah-pi-0.1.0.tgz
```

Create `.moah/releases` first. The tarball includes compiled runtime files and
the lazy-SDK adapter, but not local caches, credentials, raw runs or development
dependencies. The GitHub source archive includes the paper, plots, numerical
evidence, test suite and benchmark fixtures.

Historical development notes are retained as chronology, not additional primary
cohorts. The English paper and its published data are the authoritative account
of the claims made in this release.
