# Published evidence

- `real-trials.json`: all 24 primary real-model attempts, outcomes, usage,
  request schema/payload lengths, provider audits and source-file hashes.
- `real-summary.csv`: 18 cohort/task/mode rows. Means include failures.
- `controlled.json`: three scripted rich-profile trials, serialized request
  lengths/schema hashes and memory summaries. No paid model usage is inferred.
- `catalog-provenance.json`: full public metadata snapshot source, time, total,
  pagination and content hash.

The export omits secrets, machine paths, account IDs, raw prompt transcripts and
provider generation identifiers. Audit records retain returned model names,
providers, usage and cost. Hashes commit to locally retained source artifacts;
those private originals are not distributed or reconstructible from a hash.
This supports reanalysis and new experiments, not forensic reconstruction of
every old session.

Cohort A's original URL verifier contained an incorrectly escaped regex. Its
published outcome uses a corrected verifier on unchanged generated files.
Original pass flags and correction provenance remain. Cohort B's actual agent
and provider failures are retained. No outputs were repaired to obtain a pass.

Pi's `input` and `cacheRead` are separate counters here. Costs are reported usage
and provider audit observations, not reconstructions using current tariffs.
Audit completeness covers generation IDs present in the event log, not an
independent guarantee that every attempted request produced a billable record.
Null does not mean zero. Providers were not pinned and cache state was natural.

Historical public catalog descriptions are not redistributed. `moah catalog-sync`
fetches the complete current listing, which will differ from the research capture.
Full public discovery does not imply universal installation or compatibility.

The maintainer export utility is `scripts/export-paper-data.py`; end users need
only `python paper/figures.py` and the published data to regenerate charts.
