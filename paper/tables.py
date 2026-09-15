"""Refresh the report's primary result table from published data."""
import json
from pathlib import Path
root = Path(__file__).resolve().parent
data = json.loads((root / "data/real-trials.json").read_text(encoding="utf-8"))
lines = ["| Cohort | Task | Harness | Artifact / strict | Runtime s | Cost USD | Schema bytes/request | Peak MiB |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |"]
names = {"native": "Pi", "resident": "MoAH resident", "streaming": "MoAH streaming"}
for c in data["cohorts"]:
    for r in c["summary"]:
        lines.append(f"| {c['id']} | {'Inventory' if r['task'] == 'inventory-repair' else 'URL policy'} | {names[r['mode']]} | {r['artifactsPassed']}/{r['attempted']} · {r['passed']}/{r['attempted']} | {r['meanElapsedSeconds']:.2f} | {r['meanEstimatedCostUsd']:.6f} | {r['meanSchemaBytesPerRequest']:.0f} | {r['meanSampledPeakWorkingSetMiB']:.1f} |")
path = root / "MoAH.md"
text = path.read_text(encoding="utf-8")
start = "<!-- RESULTS_TABLE -->"
end = "<!-- END_RESULTS_TABLE -->"
before, after = text.split(start, 1)
if end in after:
    after = after.split(end, 1)[1]
path.write_text(before + start + "\n\n" + "\n".join(lines) + "\n\n" + end + after, encoding="utf-8")
print("Updated 18 result rows.")
