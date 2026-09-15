"""Regenerate all paper figures from published, sanitized measurements."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "figures"
OUT.mkdir(exist_ok=True)
DATA = json.loads((ROOT / "data/real-trials.json").read_text(encoding="utf-8"))
MODES = ["native", "resident", "streaming"]
LABELS = ["Pi", "MoAH resident", "MoAH streaming"]
COLORS = ["#576778", "#327eaf", "#16847a"]
TASKS = ["inventory-repair", "url-policy"]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "svg.fonttype": "none", "figure.facecolor": "white", "axes.titleweight": "bold"})

def save(fig, name):
    plt.rcParams["svg.hashsalt"] = "moah-v0.1.0"
    svg = OUT / (name + ".svg")
    fig.savefig(svg, bbox_inches="tight", metadata={"Date": None})
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
    fig.savefig(OUT / (name + ".png"), dpi=180, bbox_inches="tight")
    plt.close(fig)

for c in DATA["cohorts"]:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.6))
    for ax, key, unit, scale in [(axes[0], "meanElapsedSeconds", "Runtime (seconds)", 1), (axes[1], "meanEstimatedCostUsd", "Reported cost (US cents)", 100)]:
        for j, mode in enumerate(MODES):
            rows = [next(r for r in c["summary"] if r["task"] == task and r["mode"] == mode) for task in TASKS]
            pos = np.arange(2) + (j - 1) * .23
            bars = ax.bar(pos, [r[key] * scale for r in rows], width=.21, color=COLORS[j], label=LABELS[j])
            for bar, row in zip(bars, rows):
                if row["artifactsPassed"] < row["attempted"]:
                    bar.set_hatch("///"); bar.set_edgecolor("#a32934")
                if row["passed"] < row["artifactsPassed"]:
                    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), "†", ha="center", va="bottom", color="#a32934", fontsize=15)
            for i, task in enumerate(TASKS):
                trials = [r for r in c["runs"] if r["task"] == task and r["mode"] == mode]
                if len(trials) > 1:
                    vals = [(r["elapsedMs"] / 1000 if key == "meanElapsedSeconds" else r["usage"]["estimatedCostUsd"] * 100) for r in trials]
                    ax.scatter(pos[i] + np.linspace(-.035, .035, len(vals)), vals, s=20, c="white", edgecolors="#222", zorder=4)
        ax.set_xticks(range(2), ["Inventory", "Web → URL policy"])
        ax.set_ylabel(unit); ax.set_ylim(bottom=0); ax.grid(axis="y", alpha=.16); ax.set_axisbelow(True)
    fig.suptitle(f"{c['profile'].capitalize()} installed profile · cohort {c['id']}", fontsize=15)
    handles = [Patch(color=color, label=label) for color, label in zip(COLORS, LABELS)]
    handles.append(Patch(facecolor="white", edgecolor="#a32934", hatch="///", label="Artifact failed"))
    fig.legend(handles=handles, loc="lower center", ncol=4, frameon=False, bbox_to_anchor=(.5, .05))
    fig.text(.5, .015, "All attempts included. Dots: individual repetitions where n = 2. † Correct artifact after provider errors.", ha="center", fontsize=8.5)
    fig.tight_layout(rect=[0, .14, 1, .94]); save(fig, "real-" + c["id"])

fig, axes = plt.subplots(1, 3, figsize=(12, 4.3), sharey=True)
for ax, c in zip(axes, DATA["cohorts"]):
    for j, mode in enumerate(MODES):
        rows = [next(r for r in c["summary"] if r["task"] == t and r["mode"] == mode) for t in TASKS]
        ax.bar(np.arange(2) + (j - 1) * .23, [r["meanSchemaBytesPerRequest"] / 1000 for r in rows], width=.21, color=COLORS[j])
    ax.set_title("Cohort " + c["id"]); ax.set_xticks(range(2), ["Inventory", "URL policy"]); ax.grid(axis="y", alpha=.15); ax.set_axisbelow(True)
axes[0].set_ylabel("Mean schema size per request (kB, decimal)")
fig.suptitle("Smaller active schemas do not guarantee lower total cost", fontsize=14)
fig.legend(handles=[Patch(color=c, label=l) for c, l in zip(COLORS, LABELS)], loc="lower center", ncol=3, frameon=False)
fig.tight_layout(rect=[0, .08, 1, .94]); save(fig, "schemas")

controlled = json.loads((ROOT / "data/controlled.json").read_text())
fig, axes = plt.subplots(1, 2, figsize=(10, 4.6))
for ax, key, title in [(axes[0], "sampledPeakMiB", "Sampled process-tree peak"), (axes[1], "meanCorePhaseMiB", "Mean during subsequent core phase")]:
    values = [next(r[key] for r in controlled["summary"] if r["mode"] == m) for m in MODES]
    bars = ax.bar(range(3), values, color=COLORS, width=.6)
    ax.bar_label(bars, fmt="%.1f", padding=3); ax.set_xticks(range(3), ["Pi", "MoAH\nresident", "MoAH\nstreaming"])
    ax.set_ylabel("Working set (MiB)"); ax.set_title(title); ax.set_ylim(0, 475); ax.grid(axis="y", alpha=.15); ax.set_axisbelow(True)
fig.suptitle("Controlled sequence · temporary overhead, lower post-release residency", fontsize=13)
fig.text(.5, .015, "One trial per mode; scripted provider, real tools. Shared pages may be counted repeatedly. Peak ≠ phase mean.", ha="center", fontsize=8.5)
fig.tight_layout(rect=[0, .05, 1, .94]); save(fig, "controlled-memory")

fig, axes = plt.subplots(1, 3, figsize=(12, 4.7), sharey=True)
for ax, c in zip(axes, DATA["cohorts"]):
    rows = [next(r for r in c["summary"] if r["task"] == task and r["mode"] == mode) for task in TASKS for mode in MODES]
    x = np.arange(6)
    raw = np.array([r["meanInputTokens"] for r in rows]) / 1000
    cached = np.array([r["meanCacheReadTokens"] for r in rows]) / 1000
    ax.bar(x, raw, color=[COLORS[i % 3] for i in range(6)])
    ax.bar(x, cached, bottom=raw, color=[COLORS[i % 3] for i in range(6)], alpha=.3, hatch="..")
    ax.set_xticks(x, ["Pi", "Res.", "Str."] * 2, fontsize=9); ax.set_title("Cohort " + c["id"])
    ax.text(1, -.14, "Inventory", ha="center", transform=ax.get_xaxis_transform()); ax.text(4, -.14, "URL policy", ha="center", transform=ax.get_xaxis_transform())
    ax.axvline(2.5, color="#bbb", lw=.8); ax.grid(axis="y", alpha=.15); ax.set_axisbelow(True)
axes[0].set_ylabel("Mean accumulated input tokens (thousands)")
fig.suptitle("Natural provider caching changes the economics", fontsize=14)
fig.legend(handles=[Patch(facecolor="#576778", label="Uncached input"), Patch(facecolor="#cbd2da", hatch="..", label="Cache reads")], loc="lower center", ncol=2, frameon=False)
fig.tight_layout(rect=[0, .09, 1, .94]); save(fig, "cache")
print("Generated six figures in SVG and PNG.")
