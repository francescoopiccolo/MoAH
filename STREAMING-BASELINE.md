# MoAH clean SSD-backed streaming baseline

## Status

The streamed artifact path is runtime-independent.

```text
NO runtime edge to full upstream @earendil-works/pi-coding-agent
```

Pi-compatible imports resolve to:

```text
src/worker-sdk/pi-coding-agent.ts
src/worker-sdk/pi-ai.ts
src/worker-sdk/pi-tui.ts
```

Prebuilt artifacts:

```text
stream-artifacts/hello.bundle.mjs
stream-artifacts/structured-output.bundle.mjs
stream-artifacts/rg.bundle.mjs
```

Build guard:

```text
scripts/build-stream-artifacts.mjs
```

fails if a generated artifact contains a forbidden upstream runtime import.

## Clean real rg workload

Model:

```text
openrouter/openai/gpt-4o-mini
```

Task:

```text
Use ripgrep to search for double in src/calc.js, then report the matching line.
```

### Demand

```text
load time:       958 ms
foreground wait: 961 ms
```

### Prefetch, 5 trials

| trial | load ms | foreground wait ms | hidden fraction |
|---:|---:|---:|---:|
| 1 | 843 | 1.64 | 99.81% |
| 2 | 674 | 1.42 | 99.79% |
| 3 | 676 | 1.73 | 99.74% |
| 4 | 758 | 1.60 | 99.79% |
| 5 | 825 | 1.48 | 99.82% |

Medians:

```text
load time:        758 ms
foreground wait:  1.60 ms
hidden fraction:  99.79%
```

## Clean artifact cold import

| package | import time | worker RSS |
|---|---:|---:|
| empty worker | n/a | 68.5 MB |
| hello | 1031 ms | 118.6 MB |
| structured-output | 1115 ms | 117.4 MB |
| rg | 1041 ms | 118.9 MB |

## Process-tree RAM

| mode | startup/min working set | peak working set | mean working set |
|---|---:|---:|---:|
| Native | 92.0 MB | 134.9 MB | 102.2 MB |
| Demand | 67.0 MB | 163.2 MB | 125.9 MB |
| Prefetch | 65.4 MB | 178.9 MB | 157.3 MB |

Interpretation:

```text
Streaming saves ~26 MB at startup/idle versus Native.
Streaming currently adds ~44 MB at peak during cold worker use.
Prefetch hides almost all clean cold load when main LLM inference overlaps.
```

## Lifecycle proof

Capacity = 1:

```text
rg cold -> loads = 1
rg warm -> hits = 1, loads unchanged
structured-output -> rg evicted
rg reload -> new physical load
```

## Current conclusion

```text
Mechanism: proven.
Clean latency: strong with prefetch.
Whole-system RAM tradeoff: modest and still worker-peak-limited.
Normal-task regression and full Pi/MoAH/OpenCode clean rerun remain open.
```
