#!/usr/bin/env bash
# Conform a real capture before it enters footage/ (SCRIPTS.md §8 "Real footage"). iPhone files are HEVC,
# variable frame rate and sometimes HDR (Dolby Vision / HLG); Remotion's OffthreadVideo wants CFR H.264 SDR.
#
#   scripts/conform.sh <input> <footage-name.mp4> [ots|sr|sc]
#     ots  camera-phone footage (default): CFR 30, bt709, keeps the room audio (AAC 320k, 48 kHz)
#     sr   phone screen recording: CFR 30, scaled/cropped to fill 1080 × 1920, audio dropped (Mic off anyway)
#     sc   laptop screen capture: CFR 30, scaled to 1920 × 1080, audio dropped
#   scripts/conform.sh --audio <input> <footage-name.wav>   # room track or narration → 48 kHz stereo PCM
#
# HDR is detected from the colour transfer (smpte2084 = PQ/Dolby Vision, arib-std-b67 = HLG) and tone-mapped
# to SDR bt709 with hable. Vertical crop guidance: a landscape OTS is centre-cropped to 9:16; if the subject is
# off-centre pass CROP_X (pixels from the left of the scaled 1080-wide-equivalent frame), e.g. CROP_X=200.
# The status bar (top 160 px of a screen recording) is never cropped: SR is scaled to cover width first.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${FOOTAGE_DIR:-$HERE/../footage}"

if [[ "${1:-}" == "--audio" ]]; then
  [[ $# -eq 3 ]] || { echo "usage: conform.sh --audio <in> <name.wav>" >&2; exit 2; }
  ffmpeg -hide_banner -loglevel error -y -i "$2" -vn -ac 2 -ar 48000 -c:a pcm_s24le "$DEST/$3"
  echo "conform: $DEST/$3"; exit 0
fi
[[ $# -ge 2 ]] || { echo "usage: conform.sh <in> <name.mp4> [ots|sr|sc]" >&2; exit 2; }
in="$1"; name="$2"; kind="${3:-ots}"
trc=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer -of default=nw=1:nk=1 "$in" || true)
w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 "$in")
h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$in")
vf=()
case "$trc" in
  smpte2084|arib-std-b67)
    echo "conform: HDR ($trc) → SDR bt709 tone-map"
    vf+=("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv") ;;
esac
case "$kind" in
  ots)
    if (( w > h )); then
      echo "conform: landscape ${w}x${h} → centre-cropped 9:16 (set CROP_X to move the window)"
      vf+=("scale=-2:1920" "crop=1080:1920:${CROP_X:-(in_w-1080)/2}:0")
    else
      vf+=("scale=1080:1920:force_original_aspect_ratio=increase" "crop=1080:1920")
    fi
    audio=(-c:a aac -b:a 320k -ar 48000) ;;
  sr) vf+=("scale=1080:-2" "crop=1080:min(ih\,1920):0:0" "pad=1080:1920:0:0:color=black"); audio=(-an) ;;
  sc) vf+=("scale=1920:1080:force_original_aspect_ratio=decrease" "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white"); audio=(-an) ;;
  *) echo "conform: kind must be ots, sr or sc" >&2; exit 2 ;;
esac
vf+=("format=yuv420p")
IFS=,; filter="${vf[*]}"; unset IFS
ffmpeg -hide_banner -loglevel error -y -i "$in" -vf "$filter" -fps_mode cfr -r 30 \
  -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 "${audio[@]}" -movflags +faststart "$DEST/$name"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name,color_transfer \
  -of compact=p=0 "$DEST/$name"
echo "conform: $DEST/$name"
