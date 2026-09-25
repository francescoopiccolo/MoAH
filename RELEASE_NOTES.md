# v0.1.3 — MoAH terminal identity

The terminal now starts as MoAH, with its own title, orange theme, compact
extension inventory, and `/about` command showing both MoAH and the bundled Pi
engine versions. Optional capability warnings point to `moah doctor`.

Pi's release notices, changelog prompt, and install telemetry no longer appear
in MoAH. `moah update` explains how to update the MoAH package; extension
updates remain available through `moah update --extensions`. A theme supplied
with `--use-theme` still overrides the MoAH default for that run.

# v0.1.2 — capability availability and ripgrep

The router now omits `subagent` from every candidate path when no usable agent
definition exists. It detects a newly added agent definition without restarting
the session.

MoAH uses its own ripgrep wrapper while preserving the pinned, unmodified Pi
example for provenance checks. The wrapper passes arguments directly to `rg`,
handles paths with spaces and rejects missing search patterns. The package
smoke test verifies that a production install selects the corrected wrapper.

# v0.1.1 — routing and packaging fixes

This patch teaches the router about always-available tools and declared tool
conflicts, filters optional capabilities that are not ready at runtime, and
prevents unavailable subagents or ripgrep from being advertised to the model.

Streaming workers now resolve the development-only `tsx` loader only when the
compiled worker is absent. The production-package smoke test starts a compiled
worker from a fresh `--omit=dev` installation so this packaging regression is
covered going forward.

# v0.1.0 — research preview

MoAH runs original Pi 0.85.1 with model-selected optional tools, compact typed
discovery and demand-loaded workers for compatible stateless packages. Native
fallback preserves stateful and unsupported extension lifecycles. The public
Pi package index can be synchronized and searched in full as metadata.

This release includes an English technical report, six figures with regeneration
code, sanitized evidence from 24 real-model attempts and a separate controlled
experiment, benchmark fixtures, source tests and a portable compiled CLI.

## Downloads

- `moah-pi-0.1.0.tgz`: install with `npm install -g ./moah-pi-0.1.0.tgz`.
  Dependencies are fetched by npm. Run `moah` inside your target project; the
  first-run setup configures models, credentials, and indexing automatically.
- `MoAH-v0.1.0-source.zip`: source, lockfile, paper, plots, data and benchmarks.
- `MoAH-v0.1.0-paper.zip`: Markdown report, plots, sanitized data and plotting code.
- `SHA256SUMS.txt`: checksums for the three downloadable archives.

See README.md for Python/shell prerequisites for upstream web tools and Pi login.

## Evidence and boundaries

49 local tests passed. A production-only tarball installation was verified in
an external temporary directory, including safe initialization, bundled-package
discovery and worker loading. The package uses no checkout-relative dependency
assumption for its bundled web tools.
The Windows CI job initializes CIM before its short-process memory test.
Sampler startup/command errors are retained in diagnostics; missing measurements
are not reported as zero. No machine execution policy is changed by MoAH.

The primary experiments have 22 correct artifacts / 24 attempts and 21 strict
error-free passes. Results are exploratory and mixed: smaller schemas do not
consistently lower total cost or latency. The controlled memory improvement is
in a later phase, with a higher initial peak. OpenCode comparisons are theoretical.

No autonomous arbitrary package installation/removal, human-effort savings or
physical SSD advantage is claimed. Windows is the locally validated platform.
This release is a research artifact, not a hardened service.
