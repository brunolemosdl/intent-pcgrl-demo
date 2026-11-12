"""Trace episodes of the released final policy, frame by frame.

Run from the intent-pcgrl repo root with its venv (tools/build_data.sh does this):
  .venv/bin/python path/to/tools/trace_episodes.py OUT_DIR [JOB ...]

For each case it writes PNG frames (one per accepted decision), the final
polished level (PNG + engine string for the A* recorder) and a JSON manifest
with the target, measured vector and error at each frame.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from pcgrl.core.settings.loader import load_config
from pcgrl.core.helpers.seed import seed_all
from pcgrl.core.tiles.engine import level_to_engine_string
from pcgrl.learning.env_factory import build_env_context, make_env
from pcgrl.rendering.png import PngRenderer
from pcgrl.runtime.metrics.intent import compute_intent_vector
from pcgrl.runtime.refine import IntentRefiner
from pcgrl.runtime.validators.runner import ValidatorRunner

DIMS = ["enemies", "coins", "blocks", "pipes", "gaps", "verticality", "smoothness", "platforms"]
CKPT = "artifacts/models/final10m_seed42/policy_final.zip"

# name -> (prompt shown to the audience, target vector)
CASES: dict[str, tuple[str, list[float]]] = {
    "flat_empty": ("A speedrunner's dream: flat, empty and smooth.",
                   [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]),
    "hilly_rich": ("A hilly level with coins, blocks and platforms.",
                   [0.4, 0.8, 0.8, 0.3, 0.3, 0.85, 0.35, 0.8]),
    "hard": ("Packed with enemies and wide pits; a real challenge.",
             [0.88, 0.4, 0.5, 0.3, 0.61, 0.65, 0.4, 0.55]),
    "peaceful": ("A peaceful stroll: no enemies, no gaps, just a few coins.",
                 [0.08, 0.2, 0.5, 0.3, 0.11, 0.65, 0.4, 0.55]),
    "vertical": ("A vertical climbing stage full of floating platforms.",
                 [0.5, 0.4, 0.5, 0.3, 0.4, 0.95, 0.4, 0.95]),
    "pipes": ("A garden of pipes with coins tucked between them.",
              [0.5, 0.7, 0.5, 0.7, 0.4, 0.65, 0.4, 0.55]),
    "coins": ("Coin heaven with barely any danger.",
              [0.05, 0.95, 0.5, 0.3, 0.4, 0.65, 0.4, 0.55]),
    "chaos": ("Maximum chaos: everything everywhere all at once.",
              [0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.05, 0.95]),
}

# Extra jobs (e.g. the interactive demo): JSON {name: [prompt, target]}.
if os.environ.get("JOBS_FILE"):
    CASES.update({k: (v[0], v[1]) for k, v in json.loads(Path(os.environ["JOBS_FILE"]).read_text()).items()})

# Enemy-density sweep for the interactive slider (others at corpus defaults).
DEFAULTS = [0.5, 0.4, 0.5, 0.3, 0.4, 0.65, 0.4, 0.55]
SWEEP_DIMS = {0: "enemies", 1: "coins", 4: "gaps", 5: "verticality"}
SWEEP_VALUES = [0.0, 0.25, 0.5, 0.75, 1.0]


def astar_gate(engine_text: str, runs: int = 3) -> tuple[bool, float]:
    """Release gate from the paper: >=1 A* win and mean completion >= 0.95."""
    cp, run_dir = os.environ["RECORDER_CP"], os.environ["RECORDER_RUN"]
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write(engine_text)
    wins, comps = 0, []
    for _ in range(runs):
        res = subprocess.run(
            ["java", "-Djava.awt.headless=true", "-cp", cp,
             "org.intentpcgrl.record.Recorder", fh.name, "/dev/null/x", "0", "30"],
            cwd=run_dir, capture_output=True, text=True, check=True)
        r = json.loads(res.stdout.strip().splitlines()[-1])
        wins += r["status"] == "WIN"
        comps.append(min(1.0, float(r["completion"])))
        if not wins and len(comps) >= 2 and max(comps) < 0.9:
            break
    mean = sum(comps) / len(comps)
    return wins >= 1 and mean >= 0.95, mean


def main(out: Path, jobs: list[str]) -> None:
    config = load_config(training="final", seed=42)
    seed_all(42)
    ctx = build_env_context(config)
    env = make_env(config, ctx, seed=42)
    model = MaskablePPO.load(CKPT, device="cpu")
    renderer = PngRenderer(ctx.catalog, tile_size_px=16)
    structural = ValidatorRunner(config, ctx.catalog)
    refiner = IntentRefiner(config, ctx.catalog,
                            tolerance=config.generation.polish.tolerance,
                            max_passes=config.generation.polish.max_passes)
    out.mkdir(parents=True, exist_ok=True)

    def measure(level) -> list[float]:
        return [round(float(x), 4) for x in compute_intent_vector(level, ctx.catalog, config)]

    def run(name: str, prompt: str, target: list[float], frames: bool, seeds=range(42, 50)):
        t = np.asarray(target, dtype=np.float32)
        cands = []
        for seed in seeds:  # best-of-N, like the release pipeline
            obs, _ = env.reset(seed=seed, options={"target": t})
            steps, done = [], False
            while not done:
                was_edit = env.in_edit_phase
                action, _ = model.predict(obs, action_masks=env.action_masks(), deterministic=False)
                before = env.get_level().tiles.copy() if was_edit else None
                obs, reward, term, trunc, info = env.step(int(action))
                done = term or trunc
                lvl = env.get_level()
                changed = before is None or not np.array_equal(before, lvl.tiles)
                if changed:
                    phase = "edit" if was_edit else "compose"
                    if not was_edit and env.in_edit_phase:
                        phase = "stitched"
                    meta = {"cols": int(env._state.used_width)}
                    if was_edit and env._edit_log:
                        e = env._edit_log[-1]
                        meta.update(op=str(e["op"]), segment=int(e["segment"]))
                    steps.append((phase, lvl, meta))
            final = env.get_level()
            valid = structural.validate(final).is_valid
            err = float(np.mean(np.abs(np.asarray(measure(final)) - t)))
            rew = float(reward)
            if valid:
                cands.append((rew, err, seed, steps, final))
        # Keep the level that best matches the request. Each candidate is
        # considered with and without polish (polish can overshoot when targets
        # compete), ranked by mean error plus half the worst single error, and
        # the chosen level must still pass the A* release gate.
        def score(lvl) -> float:
            m = np.asarray(measure(lvl))
            dev = np.abs(m - t)
            # "none" (a count target <= 0.05) must look like none on screen
            none_missed = bool(np.any((t[:5] <= 0.05) & (m[:5] >= 0.03)))
            return float(dev.mean() + 0.5 * dev.max() + (1.0 if none_missed else 0.0))

        options = []
        for rew, err, seed, steps, final in cands:
            options.append((score(final), rew, err, seed, steps, final, final))
            pol = refiner.refine(final, t)
            if pol.applied and structural.validate(pol.level).is_valid:
                options.append((score(pol.level), rew, err, seed, steps, final, pol.level))
        options.sort(key=lambda o: o[0])
        chosen = None
        for _, rew, err, seed, steps, final, level in options[:12]:
            ok, comp = astar_gate(level_to_engine_string(level, ctx.catalog))
            if ok:
                chosen = (rew, err, seed, steps, final, level, comp)
                break
        if chosen is None:
            print(f"{name}: no candidate passed the A* gate", flush=True)
            return None
        rew, err, seed, steps, final, polished, comp = chosen
        case = {"name": name, "prompt": prompt, "target": target, "seed": seed,
                "reward": rew, "astar_completion": round(comp, 3), "frames": []}
        d = out / name
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        seq = steps if frames else []
        seq = seq + [("polish", polished, {"cols": int(polished.width_tiles)})]
        for i, (phase, lvl, meta) in enumerate(seq):
            m = measure(lvl)
            fn = f"{i:02d}_{phase}.png"
            img = renderer.render(lvl)
            img.save(d / fn, optimize=True)
            case["frames"].append({
                "file": f"{name}/{fn}", "phase": phase, "width": img.width, **meta,
                "rows": level_to_engine_string(lvl, ctx.catalog).splitlines(),
                "measured": m, "error": round(float(np.mean(np.abs(np.asarray(m) - t))), 4),
            })
        (d / "final.txt").write_text(level_to_engine_string(polished, ctx.catalog))
        print(f"{name}: seed={seed} frames={len(seq)} err_raw={err:.3f} "
              f"err_final={case['frames'][-1]['error']:.3f}", flush=True)
        return case

    for job in jobs:
        if os.environ.get("SKIP_DONE") and (out / job / "case.json").exists():
            continue
        if job in CASES:
            prompt, target = CASES[job]
            c = run(job, prompt, target, frames=True,
                    seeds=range(42, 42 + int(os.environ.get("N_SEEDS", "8"))))
        else:
            _, dname, v = job.split("_")
            target = list(DEFAULTS)
            target[{n: k for k, n in SWEEP_DIMS.items()}[dname]] = int(v) / 100
            c = run(job, f"{dname}={int(v) / 100}", target, frames=False,
                    seeds=range(42, 42 + int(os.environ.get("N_SEEDS", "8"))))
        if c:
            (out / job / "case.json").write_text(json.dumps(c, indent=1))


def all_jobs() -> list[str]:
    return list(CASES) + [f"sweep_{d}_{int(v * 100):03d}" for d in SWEEP_DIMS.values() for v in SWEEP_VALUES]


def assemble(out: Path) -> None:
    """Collect every <job>/case.json into manifest.json."""
    manifest = {"dims": DIMS, "cases": [], "sweeps": {d: [] for d in SWEEP_DIMS.values()}}
    for job in all_jobs():
        f = out / job / "case.json"
        if not f.exists():
            print("missing:", job)
            continue
        c = json.loads(f.read_text())
        if job in CASES:
            manifest["cases"].append(c)
        else:
            manifest["sweeps"][job.split("_")[1]].append(c)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("manifest:", len(manifest["cases"]), "cases,",
          sum(len(v) for v in manifest["sweeps"].values()), "sweep levels")


if __name__ == "__main__":
    out_dir, args = Path(sys.argv[1]), sys.argv[2:]
    if args == ["--list"]:
        print(" ".join(all_jobs()))
    elif args == ["--assemble"]:
        assemble(out_dir)
    else:
        main(out_dir, args or all_jobs())
