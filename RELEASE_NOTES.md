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
  Dependencies are fetched by npm. Run `moah init` inside your target project.
- `MoAH-v0.1.0-source.zip`: source, lockfile, paper, plots, data and benchmarks.
- `MoAH-v0.1.0-paper.zip`: Markdown report, plots, sanitized data and plotting code.
- `SHA256SUMS.txt`: checksums for the three downloadable archives.

See README.md for Python/shell prerequisites for upstream web tools and Pi login.

## Evidence and boundaries

49 local tests passed. A production-only tarball installation was verified in
an external temporary directory, including safe initialization, bundled-package
discovery and worker loading. The package uses no checkout-relative dependency
assumption for its bundled web tools.

The primary experiments have 22 correct artifacts / 24 attempts and 21 strict
error-free passes. Results are exploratory and mixed: smaller schemas do not
consistently lower total cost or latency. The controlled memory improvement is
in a later phase, with a higher initial peak. OpenCode comparisons are theoretical.

No autonomous arbitrary package installation/removal, human-effort savings or
physical SSD advantage is claimed. Windows is the locally validated platform.
Known advisories in the pinned optional semantic stack are documented in
SECURITY.md. This release is a research artifact, not a hardened service.
