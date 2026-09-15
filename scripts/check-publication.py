"""Fail before publication on private artifacts, likely secrets or broken report links."""
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
names = subprocess.check_output(["git", "ls-files", "--cached", "-z"], cwd=root).decode().split("\0")
patterns = [rb"sk-or-v1-[a-fA-F0-9]{30,}", rb"ghp_[a-zA-Z0-9]{30,}", rb"github_pat_[a-zA-Z0-9_]{30,}", rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", rb"C:[\\/]+Users[\\/]+Lenovo[\\/]", rb"gen-[0-9]{8,}-[a-zA-Z0-9]{8,}"]
errors = []
for name in filter(None, names):
    if any(p in Path(name).parts for p in [".moah", ".pi", "node_modules", ".paper-venv"]) or Path(name).name.startswith(".env"):
        errors.append("Private artifact: " + name)
        continue
    data = (root / name).read_bytes()
    if any(re.search(p, data) for p in patterns):
        errors.append("Possible sensitive content: " + name)  # Never print the match.

for name in ["README.md", "paper/MoAH.md", "paper/REPRODUCING.md", "paper/data/README.md"]:
    path = root / name
    for link in re.findall(r"\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
        if re.match(r"https?://|#", link):
            continue
        if not (path.parent / link.split("#")[0]).exists():
            errors.append(f"Broken relative link: {name} → {link}")

real = json.loads((root / "paper/data/real-trials.json").read_text(encoding="utf-8"))
runs = [r for c in real["cohorts"] for r in c["runs"]]
assert len(runs) == 24 and sum(r["artifactPassed"] for r in runs) == 22 and sum(r["passed"] for r in runs) == 21
if errors:
    raise SystemExit("\n".join(errors))
print(f"Checked {len(list(filter(None, names)))} staged files; sensitive-artifact scan, report links and outcome totals passed.")
