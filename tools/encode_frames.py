"""Encode recorder PNG frames into an animated WebP + a poster still.

usage: encode_frames.py FRAME_DIR OUT_STEM
"""
import sys
from pathlib import Path

from PIL import Image

frames_dir, stem = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(frames_dir.glob("f*.png"))
frames = [Image.open(f).convert("RGB") for f in files]
# Game runs at 30 ticks/s and we kept every 2nd tick -> ~66 ms per frame.
frames[0].save(stem.with_suffix(".webp"), save_all=True, append_images=frames[1:],
               duration=66, loop=0, lossless=True, method=4)
frames[min(len(frames) - 1, len(frames) // 3)].save(stem.with_name(stem.name + "_still.png"))
print(f"  -> {stem.with_suffix('.webp').name}: {len(frames)} frames")
