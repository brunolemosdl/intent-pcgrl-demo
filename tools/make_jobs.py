"""Build the demo job list: recorded GPT-5.2 requests + sweep and random vectors.

  python3 tools/make_jobs.py ~/path/to/intent-pcgrl work/jobs.json
"""
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

repo, out = Path(sys.argv[1]), Path(sys.argv[2])
store = json.loads((repo / "data/descriptions/recorded_store.json").read_text())
by = defaultdict(list)
for v in store.values():
    by[v["description"]].append(v)

DIMS = ["enemies", "coins", "blocks", "pipes", "gaps", "verticality", "smoothness", "platforms"]
DEFAULTS = [0.5, 0.4, 0.5, 0.3, 0.4, 0.65, 0.4, 0.55]
jobs, meta = {}, {}
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]
for i, (desc, recs) in enumerate(sorted(by.items())):
    rec = max(recs, key=lambda r: r["created_at"])          # latest recording
    name = f"ask{i:03d}"
    jobs[name] = [desc, [round(float(x), 4) for x in rec["vector"]]]
    meta[name] = {"kind": "ask", "prompt": desc, "rationale": rec.get("rationale", ""),
                  "handwritten": not desc.startswith("A level with"), "recorded_at": rec["created_at"]}
for d, dim in enumerate(DIMS):
    for v in (0.0, 0.25, 0.5, 0.75, 1.0):
        t = list(DEFAULTS); t[d] = v
        name = f"dial-{dim}-{int(v * 100):03d}"
        jobs[name] = [f"{dim} = {v}", t]; meta[name] = {"kind": "dial"}
# The "In numbers" presets of the page, so each one has an exact level.
PRESETS = {"preset-flat-empty": ("flat & empty", [0, 0, 0, 0, 0, 0, 1, 0]),
           "preset-pipe-garden": ("pipe garden", [0.5, 0.7, 0.5, 1, 0.4, 0.65, 0.4, 0.55])}
for name, (label, t) in PRESETS.items():
    jobs[name] = [label, t]; meta[name] = {"kind": "dial"}
rng = random.Random(2026)
for i in range(60):
    t = [round(rng.random(), 2) for _ in DIMS]
    name = f"rand{i:02d}"
    jobs[name] = [f"random vector {i}", t]; meta[name] = {"kind": "dial"}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(jobs, indent=0))
out.with_name("jobs_meta.json").write_text(json.dumps(meta, indent=0))
print(len(jobs), "jobs:", sum(m["kind"] == "ask" for m in meta.values()), "requests,",
      sum(m["kind"] == "dial" for m in meta.values()), "vectors")
