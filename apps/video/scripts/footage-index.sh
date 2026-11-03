#!/usr/bin/env bash
# Write footage/index.json: the media files present in footage/ (calculateMetadata reads it to choose real
# footage or a placeholder slate). Run automatically by render.sh; run by hand before `pnpm studio`.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../footage" && pwd)"
cd "$DIR"
shopt -s nullglob
files=(*.mp4 *.mov *.wav *.m4a)
{
  printf '['
  for i in "${!files[@]}"; do printf '%s"%s"' "$([[ $i -gt 0 ]] && echo ,)" "${files[$i]}"; done
  printf ']\n'
} > index.json
echo "footage-index: ${#files[@]} file(s) → $DIR/index.json"
