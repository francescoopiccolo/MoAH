# Contributing

Use Node 22.19+; Node 24 on Windows is the locally validated environment.
Run `npm ci`, `npm run build`, and `npm test` before submitting a change.
Integration test files run sequentially: concurrent full-SDK worker imports on
small machines can exhaust startup timeout budgets. Keep performance measurement
separate from functional test scheduling.

Preserve original Pi behavior for unsupported lifecycles. Do not silently remove
extensions from a comparison or label public package metadata as installed tools.
Package streaming needs a statelessness rationale and an execution/release check;
schema matching alone is insufficient to establish behavioral compatibility.

For new performance claims, include fixtures, exact installed profile, model and
provider policy, cache conditions, all attempts, artifact verification, sample
count and measurement units. Keep scripted and real-model experiments separate.
Use existing published data to reproduce figures before adding new cohorts.

Do not commit API keys, `.moah`, `.pi`, raw private session logs, machine-specific
credentials or embedding caches. Review generated artifacts before publication.
Preserve negative results. File bug reports with a minimal sanitized reproduction.
