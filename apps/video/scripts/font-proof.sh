#!/usr/bin/env bash
# Font-guard proof (SCRIPTS.md §8 QA #3):
#  1. FontProbe {mode: product}  vs  {mode: fallback}: the pixel hashes must differ (the product faces paint).
#  2. FontProbe {mode: product} rendered twice must hash the same (deterministic).
#  3. FontProbe {mode: sabotage}: the guard is asked to accept an unregistered family; the render must FAIL.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
OUT="${RENDER_OUT:-$(cd "$PKG/../.." && pwd)/marketing/videos/renders}/font-proof"
BROWSER="${REMOTION_BROWSER:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome}"
mkdir -p "$OUT"; cd "$PKG"; bash "$HERE/footage-index.sh" >/dev/null
still() { node_modules/.bin/remotion still src/index.ts FontProbe "$2" --props="{\"mode\":\"$1\"}" \
  --browser-executable "$BROWSER" --chrome-mode chrome-for-testing --overwrite --log=error; }
still product "$OUT/product.png"; still product "$OUT/product-again.png"; still fallback "$OUT/fallback.png"
hash() { ffmpeg -v error -i "$1" -f md5 - | cut -d= -f2; }
p=$(hash "$OUT/product.png"); p2=$(hash "$OUT/product-again.png"); f=$(hash "$OUT/fallback.png")
printf 'product   %s\nproduct#2 %s\nfallback  %s\n' "$p" "$p2" "$f"
[[ "$p" == "$p2" ]] || { echo "font-proof: FAIL product render is not deterministic"; exit 1; }
[[ "$p" != "$f" ]] || { echo "font-proof: FAIL product and fallback renders are identical"; exit 1; }
if still sabotage "$OUT/sabotage.png" >"$OUT/sabotage.log" 2>&1; then
  echo "font-proof: FAIL the guard accepted an unregistered family"; exit 1
fi
grep -o 'font guard: [^;]*' "$OUT/sabotage.log" | head -1
echo "font-proof: ok (product ≠ fallback; deterministic; sabotage render refused)"
