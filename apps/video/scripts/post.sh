#!/usr/bin/env bash
# Post (SCRIPTS.md §8): two-pass loudnorm to −14 LUFS integrated / −1 dBTP / LRA 11, 48 kHz AAC 320k,
# video stream copied, +faststart. A silent track (placeholder renders, no room/narration yet) cannot be
# normalised; it is copied through and reported as silent.
#   scripts/post.sh <in.mp4> <out.mp4>
set -euo pipefail
in="$1"; out="$2"
measure=$(ffmpeg -hide_banner -nostats -i "$in" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
field() { printf '%s' "$measure" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
ii=$(field input_i)
if [[ -z "$ii" || "$ii" == "-inf" ]] || awk -v i="$ii" 'BEGIN{exit !(i < -70)}'; then
  echo "   post: audio is silent (input_i=${ii:-n/a}); copying without loudnorm"
  ffmpeg -hide_banner -loglevel error -y -i "$in" -c copy -movflags +faststart "$out"
  exit 0
fi
filter="loudnorm=I=-14:TP=-1:LRA=11:measured_I=$ii:measured_TP=$(field input_tp):measured_LRA=$(field input_lra):measured_thresh=$(field input_thresh):offset=$(field target_offset):linear=true"
ffmpeg -hide_banner -loglevel error -y -i "$in" -c:v copy -af "$filter" -ar 48000 -c:a aac -b:a 320k \
  -movflags +faststart "$out"
echo "   post: loudnorm from ${ii} LUFS → −14"
