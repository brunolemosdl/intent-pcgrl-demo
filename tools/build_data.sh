#!/usr/bin/env bash
# Generate every demo level with the released policy (best-of-N + polish +
# A* release gate) and record the A* agent playing it. Resumable.
#   REPO=~/path/to/intent-pcgrl tools/build_data.sh      (writes ./work)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${REPO:-$HOME/workspace/ufmg/intent-pcgrl}"
M="$REPO/vendor/mario"; OUT="${DEMO_WORK:-$HERE/work}"
BUILD="${TMPDIR:-/tmp}/aiide-recorder"
mkdir -p "$BUILD/classes" "$BUILD/run" "$OUT/levels" "$OUT/gameplay"
python3 -c "
import glob
fs=glob.glob('$M/source/**/*.java',recursive=True)+['$HERE/tools/recorder/Recorder.java']
open('$BUILD/srcs.txt','w').write('\n'.join(fs))"
javac -nowarn -encoding UTF-8 -cp "$M/lib/json.jar" -d "$BUILD/classes" @"$BUILD/srcs.txt" 2>&1 | grep -v '^Note' || true
ln -sfn "$REPO/assets/mario" "$BUILD/run/img"
export RECORDER_CP="$BUILD/classes:$M/lib/json.jar" RECORDER_RUN="$BUILD/run"
export JOBS_FILE="$OUT/jobs.json" SKIP_DONE=1 N_SEEDS="${N_SEEDS:-8}"
python3 -c "import json;print('\n'.join(json.load(open('$OUT/jobs.json'))))" | (cd "$REPO" && xargs -P "${PAR:-6}" -I{} \
  sh -c '"$0" -u "$1" "$2" "$3" 2>/dev/null' "$REPO/.venv/bin/python" "$HERE/tools/trace_episodes.py" "$OUT/levels" {})
for lvl in "$OUT"/levels/*/final.txt; do
  name="$(basename "$(dirname "$lvl")")"
  [[ -f "$(dirname "$lvl")/case.json" ]] || continue
  [[ -f "$OUT/gameplay/$name.webp" ]] && continue
  for attempt in 1 2 3 4; do
    rm -rf "$BUILD/frames/$name"
    res=$(cd "$BUILD/run" && java -Djava.awt.headless=true -cp "$RECORDER_CP" org.intentpcgrl.record.Recorder "$lvl" "$BUILD/frames/$name" 2 30)
    [[ "$res" == *'"WIN"'* ]] && break
  done
  [[ "$res" == *'"WIN"'* ]] || { echo "$name: no winning recording"; continue; }
  "$REPO/.venv/bin/python" -I "$HERE/tools/encode_frames.py" "$BUILD/frames/$name" "$OUT/gameplay/$name" >/dev/null
  echo "$name recorded"
done
echo "levels: $(ls "$OUT"/levels/*/case.json | wc -l) · recordings: $(ls "$OUT"/gameplay/*.webp | wc -l)"
