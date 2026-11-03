#!/usr/bin/env bash
# Forbidden-pattern scan (docs/THREAT-MODEL.md T-31, T-37, T-44, T-50, T-64, T-68, T-86).
#   security/redteam/tools/scan.sh <path-or-file>...     # e.g. .e2e/api.log .e2e/ledger-dump.json fixtures/ docs/ scripts/
# Exit 0 = clean, 1 = at least one hit, 2 = usage or tool error (a scan that cannot run is never "clean").
#
# Mocks, tests, fixtures and the red-team docs may contain the Anvil keys and the MockReseller LPA form, so they are scanned
# with the rules tagged `[relaxed-skip]` removed; everything else gets the full list.
#
# Implementation note: GNU grep -P accepts ONE pattern only ("the -P option only supports a single pattern"), so the pattern
# file is compiled into a single alternation (?:p1)|(?:p2)|… . A grep exit status of 2 is treated as a failure.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS="${SCAN_PATTERNS:-$HERE/forbidden-patterns.txt}"
[[ $# -ge 1 ]] || { echo "usage: scan.sh <paths...>" >&2; exit 2; }
[[ -r "$PATTERNS" ]] || { echo "scan: pattern file $PATTERNS unreadable" >&2; exit 2; }

# full list: every non-comment, non-blank line (a trailing "  # [relaxed-skip]" tag is stripped)
compile() { # $1 = full|relaxed
  local mode="$1" line out=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" ]] && continue
    if [[ "$line" == *"# [relaxed-skip]" ]]; then
      [[ "$mode" == relaxed ]] && continue
      line="${line%"# [relaxed-skip]"}"
    fi
    line="${line%"${line##*[![:space:]]}"}"          # trim trailing whitespace
    out+="${out:+|}(?:${line})"
  done < "$PATTERNS"
  printf '%s' "$out"
}
FULL="$(compile full)"; RELAXED="$(compile relaxed)"
[[ -n "$FULL" ]] || { echo "scan: no patterns compiled" >&2; exit 2; }

# self-check: the compiled expression must be valid PCRE and must fire on a canary
echo 'canary LPA:1$smdp'""'.carrier.com$K2-ABCD-EFGH' | grep -q -P -- "$FULL" || { echo "scan: compiled pattern failed its canary (grep -P error?)" >&2; exit 2; }

status=0
scan_file() { # $1 file, $2 regex
  local out rc
  set +e; out="$(grep -n -P -- "$2" "$1" 2>&1)"; rc=$?; set -e
  case $rc in
    0) echo "FORBIDDEN PATTERN in $1:"; printf '%s\n' "$out" | cut -c1-200 | sed 's/^/    /'; status=1 ;;
    1) : ;;
    *) echo "scan: grep error on $1: $out" >&2; status=2 ;;
  esac
}

for target in "$@"; do
  [[ -e "$target" ]] || { echo "scan: skip missing $target" >&2; continue; }
  while IFS= read -r -d '' file; do
    file="$(realpath "$file")"
    case "$file" in
      */node_modules/*|*/.git/*|*/dist/*|*/.next/cache/*|*.png|*.jpg|*.jpeg|*.webp|*.woff|*.woff2|*.ttf|*.pdf|*.mp4|*.mov|*.ico) continue ;;
    esac
    re="$FULL"
    case "$file" in
      */mocks/*|*/test/*|*/fixtures/*|*.test.ts|*.spec.ts|*/security/redteam/*|*/docs/THREAT-MODEL.md|*/scripts/dev-chain.sh|*/.env.example) re="$RELAXED" ;;
    esac
    scan_file "$file" "$re"
  done < <(find "$(realpath "$target")" -type f -print0)
done
case $status in
  0) echo "scan: clean" ;;
  1) echo "scan: FAIL (forbidden patterns found)" ;;
  *) echo "scan: ERROR (scan could not complete)" ;;
esac
exit $status
