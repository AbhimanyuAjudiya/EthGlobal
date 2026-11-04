#!/usr/bin/env bash
# Render every composition (SCRIPTS.md §8 "Render"), loudness-normalise it (§8 "Post"), and print a QA probe
# table (duration, resolution, fps, codecs, loudness, size).
#
#   scripts/render.sh                    # full quality, all five videos
#   scripts/render.sh --draft            # --scale 0.5 --jpeg-quality 60 --crf 28 for a quick pipeline check
#   scripts/render.sh --only Short02Scratch,JudgeVideo
#   scripts/render.sh --qa-only          # just probe what is already in marketing/videos/renders/
#
# Remotion never downloads a browser: the sandbox's only Chrome is passed explicitly (REMOTION_BROWSER overrides).
# Output: marketing/videos/renders/<file>.mp4 (git-ignored); raw pre-loudnorm files in renders/raw/; the probe table
# is also written to renders/index.json (the one tracked file there), with the footage each render used.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$PKG/../.." && pwd)"
OUT="${RENDER_OUT:-$ROOT/marketing/videos/renders}"
BROWSER="${REMOTION_BROWSER:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome}"
CONCURRENCY="${CONCURRENCY:-$(nproc)}"

# id:file:expected-frames:width:height
VIDEOS=(
  "Short01NoService:short-01-no-service:600:1080:1920"
  "Short02Scratch:short-02-scratch:450:1080:1920"
  "Short03AgentPaid:short-03-agent-paid:540:1080:1920"
  "Short04GiftToName:short-04-gift-to-name:420:1080:1920"
  "JudgeVideo:judge-recharge:5400:1920:1080"
)

draft=0; only=""; qa_only=0; suffix=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --draft) draft=1; suffix="${SUFFIX-.draft}" ;;
    --only) only="$2"; shift ;;
    --qa-only) qa_only=1 ;;
    *) echo "render: unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -x "$BROWSER" ]] || { echo "render: no Chrome at $BROWSER (set REMOTION_BROWSER)" >&2; exit 2; }
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo "render: ffmpeg/ffprobe missing" >&2; exit 2; }
mkdir -p "$OUT/raw"
cd "$PKG"
REMOTION="$PKG/node_modules/.bin/remotion"

selected() { [[ -z "$only" || ",$only," == *",$1,"* ]]; }

if [[ $qa_only -eq 0 ]]; then
  bash "$HERE/footage-index.sh"
  BUNDLE="$(mktemp -d)/bundle"
  echo "== bundle → $BUNDLE"
  "$REMOTION" bundle src/index.ts --out-dir "$BUNDLE" --log=error >/dev/null

  quality=(--codec h264 --crf 16 --pixel-format yuv420p --color-space bt709 --audio-codec aac
    --audio-bitrate 320k --image-format jpeg --jpeg-quality 95)
  [[ $draft -eq 1 ]] && quality=(--codec h264 --crf 28 --pixel-format yuv420p --color-space bt709
    --audio-codec aac --audio-bitrate 128k --image-format jpeg --jpeg-quality 60 --scale 0.5)

  for row in "${VIDEOS[@]}"; do
    IFS=: read -r id file _ _ _ <<<"$row"
    selected "$id" || continue
    raw="$OUT/raw/$file$suffix.mp4"
    echo "== render $id → $raw"
    start=$(date +%s)
    "$REMOTION" render "$BUNDLE" "$id" "$raw" "${quality[@]}" --enforce-audio-track \
      --concurrency "$CONCURRENCY" --browser-executable "$BROWSER" --chrome-mode chrome-for-testing \
      --overwrite --log=error
    echo "   rendered in $(( $(date +%s) - start )) s"
    bash "$HERE/post.sh" "$raw" "$OUT/$file$suffix.mp4"
  done
  rm -rf "$(dirname "$BUNDLE")"
fi

# ---- QA probe ----------------------------------------------------------------------------------------------
probe() { ffprobe -v error -select_streams "$2" -show_entries "$3" -of default=nw=1:nk=1 "$1" | head -1; }
printf '\n%-30s %9s %7s %10s %6s %6s %8s %6s %8s %8s  %s\n' file duration frames resolution fps vcodec pix_fmt acodec LUFS size_MB check
status=0
rows=()
for row in "${VIDEOS[@]}"; do
  IFS=: read -r id file frames w h <<<"$row"
  selected "$id" || continue
  for f in "$OUT/$file.mp4" "$OUT/$file.draft.mp4"; do
    [[ -f "$f" ]] || continue
    dur=$(probe "$f" v:0 format=duration); dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f")
    nb=$(probe "$f" v:0 stream=nb_frames)
    res="$(probe "$f" v:0 stream=width)x$(probe "$f" v:0 stream=height)"
    fps=$(probe "$f" v:0 stream=r_frame_rate)
    vc=$(probe "$f" v:0 stream=codec_name); pf=$(probe "$f" v:0 stream=pix_fmt)
    ac=$(probe "$f" a:0 stream=codec_name); ac=${ac:-none}
    lufs=$(ffmpeg -hide_banner -nostats -i "$f" -af ebur128 -f null - 2>&1 | awk '/Integrated loudness/{getline; print $2}' | tail -1)
    size=$(awk -v b="$(stat -c %s "$f")" 'BEGIN{printf "%.1f", b/1048576}')
    check=ok
    [[ "$nb" == "$frames" ]] || check="FAIL frames≠$frames"
    if [[ "$f" != *.draft.mp4 && "$res" != "${w}x${h}" ]]; then check="FAIL res≠${w}x${h}"; fi
    [[ "$fps" == "30/1" && "$vc" == "h264" && "$pf" == "yuv420p" ]] || check="FAIL codec/fps"
    awk -v d="$dur" 'BEGIN{exit !(d <= 180.05)}' || check="FAIL >3:00"
    [[ "$check" == ok ]] || status=1
    printf '%-30s %8.2fs %7s %10s %6s %6s %8s %6s %8s %8s  %s\n' "$(basename "$f")" "$dur" "$nb" "$res" "$fps" "$vc" "$pf" "$ac" "${lufs:--}" "$size" "$check"
    tp=$(ffmpeg -hide_banner -nostats -i "$f" -af ebur128=peak=true -f null - 2>&1 | awk '/True peak:/{getline; print $2}' | tail -1)
    num() { [[ "$1" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] && echo "$1" || echo null; } # silent tracks report -inf
    rows+=("$(printf '{"composition":"%s","file":"%s","durationS":%.3f,"frames":%s,"resolution":"%s","fps":"%s","video":"%s/%s","audio":"%s","lufs":%s,"truePeakDbtp":%s,"sizeBytes":%s,"sizeMB":%s,"renderedAt":"%s","check":"%s"}' \
      "$id" "$(basename "$f")" "$dur" "$nb" "$res" "$fps" "$vc" "$pf" "$ac" "$(num "${lufs:-}")" "$(num "${tp:-}")" "$(stat -c %s "$f")" "$size" \
      "$(date -u -r "$f" +%Y-%m-%dT%H:%M:%SZ)" "$check")")
  done
done
if [[ ${#rows[@]} -gt 0 ]]; then
  # merge: rows for files probed now replace their old rows; other renders (e.g. after --only) are kept
  printf '%s\n' "${rows[@]}" | node -e '
    const fs = require("node:fs");
    const [out, footageFile] = process.argv.slice(1);
    const fresh = fs.readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    let old = [];
    try { old = JSON.parse(fs.readFileSync(out, "utf8")).renders ?? []; } catch {}
    let footage = [];
    try { footage = JSON.parse(fs.readFileSync(footageFile, "utf8")); } catch {}
    const renders = [...old.filter((o) => !fresh.some((f) => f.file === o.file)), ...fresh]
      .sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(out, JSON.stringify({ generatedBy: "apps/video/scripts/render.sh", footage, renders }, null, 2) + "\n");
  ' "$OUT/index.json" "$PKG/footage/index.json"
  echo "render: index → $OUT/index.json"
fi
exit $status
