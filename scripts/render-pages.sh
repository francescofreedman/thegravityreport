#!/bin/bash
# Render paper PDFs to per-page SVGs for the no-viewer reading pane.
# LaTeX output is vector, so SVG pages stay perfectly crisp at any zoom and
# any pixel density — and they gzip smaller than the old 150-dpi PNGs.
# Usage: scripts/render-pages.sh papers/queta.pdf
set -e
pdf="$1"; name=$(basename "$pdf" .pdf)
out="papers/pages/$name"
mkdir -p "$out"; rm -f "$out"/*.png "$out"/*.jpg "$out"/*.svg
pages=$(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')
for ((p=1; p<=pages; p++)); do
  printf -v pp 'p-%02d' "$p"
  pdftocairo -svg -f "$p" -l "$p" "$pdf" "$out/$pp.svg"
done
echo "$pages pages -> $out (svg)"
