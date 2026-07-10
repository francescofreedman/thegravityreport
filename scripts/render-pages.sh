#!/bin/bash
# Render paper PDFs to quantized page images for the no-viewer reading pane.
# Usage: scripts/render-pages.sh papers/queta.pdf
set -e
pdf="$1"; name=$(basename "$pdf" .pdf)
out="papers/pages/$name"
mkdir -p "$out"; rm -f "$out"/*.png "$out"/*.jpg
pdftoppm -png -r 150 "$pdf" "$out/raw"
python3 - "$out" <<'PY'
import sys, glob, os
from PIL import Image
out = sys.argv[1]
files = sorted(glob.glob(f"{out}/raw-*.png"))
for i, f in enumerate(files, 1):
    im = Image.open(f).convert("RGB")
    im = im.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE)
    im.save(f"{out}/p-{i:02d}.png", optimize=True)
    os.remove(f)
print(f"{len(files)} pages quantized")
PY
echo "$name -> $out"
