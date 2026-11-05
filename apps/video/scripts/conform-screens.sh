#!/usr/bin/env bash
# Conform every headless capture in footage/screen/*.webm (scripts/capture-screens.mjs) with conform.sh:
# phone-viewport clips as `sr` (CFR 30, 1080 wide, top 1920 px kept), laptop-viewport clips (*-desktop-*) as `sc`
# (1920 × 1080). Then re-index footage/ so the compositions see them.
#   bash scripts/conform-screens.sh            # all
#   bash scripts/conform-screens.sh plan pay   # only clips whose name starts with these
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$HERE/../footage/screen"
shopt -s nullglob
for webm in "$DIR"/*.webm; do
  base="$(basename "$webm" .webm)"
  if [[ $# -gt 0 ]]; then
    match=0; for p in "$@"; do [[ "$base" == "$p"-* ]] && match=1; done
    [[ $match == 1 ]] || continue
  fi
  kind=sr; [[ "$base" == *-desktop-* ]] && kind=sc
  bash "$HERE/conform.sh" "$webm" "screen/$base.mp4" "$kind" >/dev/null
  printf 'conform-screens: %-34s %s %6.2f s\n' "$base.mp4" "$kind" \
    "$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$DIR/$base.mp4")"
done
bash "$HERE/footage-index.sh"
