"""Export allowlisted numerical evidence from private local benchmark runs.

Maintainer utility: raw runs are not distributed. Figure regeneration needs only
the exported paper/data files, not this script or private session histories.
"""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "paper" / "data"
OUT.mkdir(parents=True, exist_ok=True)

def read(path):
    return json.loads(path.read_text(encoding="utf-8"))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

cohorts = []
for ident, dirname, profile in [("A", "run-Zubmji", "rich"), ("B", "run-6KshA4", "rich"), ("C", "run-9T7ggZ", "intermediate")]:
    root = ROOT / ".moah" / "benchmark-runs" / dirname
    source = root / "reverified-results.json"
    if not source.exists():
        source = root / "results.json"
    raw, summary, audit = read(source), read(root / "summary.json"), read(root / "openrouter-usage.json")
    runs = []
    for r in raw["results"]:
        a = next(a for a in audit["results"] if all(a[k] == r[k] for k in ("task", "mode", "repetition")))
        row = {k: r[k] for k in ["task", "mode", "repetition", "elapsedMs", "preparationMs", "exitCode", "timedOut", "passed", "cacheCohort", "controlRepeatPauses"]}
        row["artifactPassed"] = r["verification"]["code"] == 0 and r["exitCode"] == 0 and not r["timedOut"]
        row["verificationExitCode"] = r["verification"]["code"]
        row["usage"] = {k: r["usage"][k] for k in ["responses", "input", "output", "cacheRead", "cacheWrite", "estimatedCostUsd", "usageMissing"]}
        row["modelErrorCount"] = len(r["usage"]["modelErrors"])
        row["memory"] = r["memory"]
        row["requests"] = [{k: p[k] for k in ("schemaBytes", "schemaHash", "serializedPayloadBytes", "names")} for p in r["providerRequests"]]
        row["perResponseUsage"] = [p["usage"] for p in r["perResponseUsage"]]
        row["audit"] = {k: a[k] for k in ("observedCostUsd", "providers", "completeness")}
        row["audit"]["generations"] = [{k: v for k, v in g.items() if k != "id"} for g in a["generations"]]
        if "originalPassed" in r:
            row["originalPassed"] = r["originalPassed"]
            row["verifierSha256"] = r["verifierSha256"]
        runs.append(row)
    cohorts.append({"id": ident, "profile": profile, "model": raw["model"], "provider": raw["provider"], "capturedAt": raw["capturedAt"],
                    "sourceRun": dirname, "resultsSource": source.name,
                    "sourceSha256": {p.name: digest(p) for p in [root / "results.json", source, root / "summary.json", root / "openrouter-usage.json", root / "suite.json", root / "package-profile.json"]},
                    "reverification": {"reason": raw["reverification"]["reason"], "time": raw["reverification"]["time"]} if "reverification" in raw else None,
                    "summary": summary["rows"], "runs": runs})
write("real-trials.json", {"formatVersion": 1, "cohorts": cohorts})
with (OUT / "real-summary.csv").open("w", encoding="utf-8", newline="") as f:
    rows = [{"cohort": c["id"], "model": c["model"], "profile": c["profile"], **r, "providers": ";".join(r["providers"])} for c in cohorts for r in c["summary"]]
    writer = csv.DictWriter(f, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)

root = ROOT / ".moah" / "controlled-runs" / "run-m6aD0f"
raw, summary = read(root / "comparison.json"), read(root / "summary.json")
write("controlled.json", {"formatVersion": 1, "sourceRun": root.name, "capturedAt": raw["capturedAt"], "schemasMatch": raw["schemasMatch"], "sourceSha256": {p.name: digest(p) for p in [root / "comparison.json", root / "summary.json"]}, "summary": summary["rows"], "runs": [{"mode": r["mode"], "passed": r["passed"], "requests": r["wire"]["requests"]} for r in raw["results"]]})
public = read(ROOT / ".moah" / "public-catalog.json")
write("catalog-provenance.json", {k: v for k, v in public.items() if k != "packages"})
assert len([r for c in cohorts for r in c["runs"]]) == 24
assert sum(r["artifactPassed"] for c in cohorts for r in c["runs"]) == 22
print("Exported 24 real trials, 3 controlled trials and public-catalog provenance.")
