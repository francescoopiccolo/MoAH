# Architecture

## Fixed points

1. Pi remains the runtime and agent loop.
2. MoAH loads Pi core tools and the safe native-resident official extensions.
3. On each user message, MoAH sends a compact combined candidate inventory to
   the API router: native registered tools plus indexed streamable tool
   metadata.
4. The router returns `{"tools":[...]}`.
5. MoAH applies selection with `pi.setActiveTools()`.

There is no local embedding router, public-catalog prompt, or resurrected
historical activation machinery. The API router remains the intelligence
layer. Streaming is a memory/runtime subsystem, not a second router.

## Memory tiers

```text
Tier A  always resident
  Pi runtime, core tools, MoAH router/control tool,
  native stateful extensions, compact streamable metadata, proxy schemas

Tier B  bounded warm worker cache
  one child process per streamable package, dynamically imported on demand

Tier C  filesystem / SSD
  installed streamable packages when not resident

Tier D  model context
  only the schemas selected for the current turn
```

The four states below are deliberately separate:

```text
KNOWN TO ROUTER
LOADED IN MEMORY
ACTIVE IN MODEL CONTEXT
EXECUTING
```

Router discovery never requires a package to be resident.

## Modules

- `src/router.ts` — OpenAI-compatible API tool router.
- `src/capabilities.ts` — `moah_select`, validation and descriptions.
- `src/catalog.ts` — corpus verification, source fingerprints, native
  arguments, and the isolated streaming probe.
- `src/corpus.ts` — official manifest and safe native-resident set.
- `src/pi-extension.ts` — `input`, `session_start`, `/moah`, `moah_select`,
  proxy registration, and router-triggered prefetch.
- `src/streaming/package-cache.ts` — bounded warm-worker cache and policy.
- `src/streaming/package-worker-client.ts` — one child process per package,
  IPC, timeout/abort cleanup.
- `src/streaming/package-worker.ts` — restricted worker runtime and tool
  capture.
- `src/streaming/types.ts` — package states, protocol and cache snapshots.
- `scripts/lazy-pi-sdk.cjs` — tiny Pi SDK compatibility facade for stateless
  workers; unrecognized exports fall back to the full SDK.

## Package state machine

```text
DISK
  | prefetch or demand
  v
LOADING
  | success and captured tools match indexed expectations
  v
RESIDENT_SELECTED  (current turn)
  | turn changes
  v
RESIDENT_IDLE
  | idle TTL / budget / capacity
  v
EVICTING -> process terminated -> DISK

LOADING -> FAILED -> DISK on error, with no published half-ready worker.
```

A resident package with an in-flight tool call is `BUSY` and is never
evictable. Speculative prefetch can evict only idle or speculative residents;
it can never evict a selected or busy foreground package. Demand may evict
lower-priority speculative workers to make room.

## Selection and prefetch

Selection remains `baseTools + optional`. Deselecting a streamed tool does not
kill its worker immediately; it becomes an idle cache candidate.

In `auto` and `oracle` modes:

```text
prompt -> API router -> selected tool list
                            |                |
                  activate schemas      async package prefetch
                            |                |
                            v                v
                      main LLM starts    package worker warms
                            |                |
                            +--------+-------+
                                     v
                          tool invocation waits only
                          for the remaining load, if any
```

The prefetch promise is deliberately not awaited before the main agent path
continues. If the model invokes the tool while its package is still loading,
the proxy waits on the same in-flight load; a package with N demanders still
has exactly one physical load.

`suggest` mode does not warm packages. `moah dense` remains the real native
control condition and loads every available package natively.

## Native fallback

A package is streamed only when:

1. `stateless: true` or `mode: "stream"` is explicitly configured;
2. its entry resolves to a single file;
3. an isolated worker probe imports it against a restricted API;
4. the worker captures tool definitions that match the indexed expectations.

Stateful extensions, lifecycle hooks, commands, custom rendering, unsupported
Pi APIs, directory package roots, and failed probes preserve their native Pi
lifecycle. Streaming never silently drops functionality.

## Source identity

The catalog records a streamed package's root source fingerprint. A change
invalidates the catalog and any runtime load against stale metadata. Existing
resident workers can finish a cache hit, but a fresh demand after eviction
must re-index.

## SSD wording

This subsystem is called disk-backed demand loading. A package load reads from
the filesystem; the operating system may serve warm pages from its page cache.
MoAH does not claim physical NVMe read bytes unless a platform-specific
measurement would support that claim.
