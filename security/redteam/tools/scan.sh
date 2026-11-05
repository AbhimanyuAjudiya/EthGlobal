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
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../../scripts/lib/gnu-path.sh" 2>/dev/null || true  # macOS GNU grep/timeout
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS="${SCAN_PATTERNS:-$HERE/forbidden-patterns.txt}"
[[ $# -ge 1 ]] || { echo "usage: scan.sh <paths...>" >&2; exit 2; }
[[ -r "$PATTERNS" ]] || { echo "scan: pattern file $PATTERNS unreadable" >&2; exit 2; }

# Tags: a rule line may end with "  # [relaxed-skip]" and/or "[docs-ok]". relaxed-skip rules are dropped for mocks/tests/fixtures/
# red-team docs; docs-ok rules (public Anvil test keys) are also dropped for docs/ and research/. Everything else always applies.
compile() { # $1 = full|relaxed|docs
  local mode="$1" line tags out=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" || "$line" == allow-exact:* ]] && continue
    tags=""
    if [[ "$line" == *"  # ["*"]" ]]; then tags="${line##*  # }"; line="${line%  # *}"; fi
    [[ "$mode" == relaxed && "$tags" == *"[relaxed-skip]"* ]] && continue
    [[ "$mode" == docs && "$tags" == *"[docs-ok]"* ]] && continue
    line="${line%"${line##*[![:space:]]}"}"          # trim trailing whitespace
    out+="${out:+|}(?:${line})"
  done < "$PATTERNS"
  printf '%s' "$out"
}
FULL="$(compile full)"; RELAXED="$(compile relaxed)"; DOCS="$(compile docs)"
# exact literals that are not a hit in a git-tracked file (forbidden-patterns.txt "allow-exact:"; never applied to logs,
# dumps or build output, which are untracked)
ALLOW=(); while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == allow-exact:\ * ]] && ALLOW+=("${line#allow-exact: }")
done < "$PATTERNS"
tracked() { git -C "$(dirname "$1")" ls-files --error-unmatch -- "$1" > /dev/null 2>&1; }
[[ -n "$FULL" ]] || { echo "scan: no patterns compiled" >&2; exit 2; }

# -P needs a PCRE grep: GNU grep (Linux; Homebrew's ggrep) or ugrep (-P via pcre2). macOS BSD grep has no -P, and a scan
# that cannot run must not read as "clean" (exit 2).
PGREP=""
for cand in ggrep grep ugrep; do
  if command -v "$cand" >/dev/null 2>&1 && echo x | "$cand" -q -P -- 'x' 2>/dev/null; then PGREP="$cand"; break; fi
done
[[ -n "$PGREP" ]] || { echo "scan: no PCRE-capable grep (install GNU grep: brew install grep; or ugrep)" >&2; exit 2; }
pgrep_() { "$PGREP" "$@"; }

# self-check: the compiled expression must be valid PCRE and must fire on a canary
echo 'canary LPA:1$smdp'""'.carrier.com$K2-ABCD-EFGH' | pgrep_ -q -P -- "$FULL" || { echo "scan: compiled pattern failed its canary (grep -P error?)" >&2; exit 2; }

status=0
scan_file() { # $1 file, $2 regex
  local out rc
  set +e; out="$(pgrep_ -n -P -- "$2" "$1" 2>&1)"; rc=$?; set -e
  if [[ $rc -eq 0 && ${#ALLOW[@]} -gt 0 ]] && tracked "$1"; then
    local kept="" hit lit
    while IFS= read -r hit; do
      for lit in "${ALLOW[@]}"; do hit="${hit//"$lit"/}"; done
      printf '%s\n' "${hit#*:}" | pgrep_ -q -P -- "$2" && kept+="$hit"$'\n'
    done <<< "$out"
    out="${kept%$'\n'}"; [[ -z "$out" ]] && rc=1
  fi
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
      */docs/*|*/research/*) re="$DOCS" ;;
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
