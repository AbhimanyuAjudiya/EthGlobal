#!/usr/bin/env bash
# Forbidden-pattern scan (docs/THREAT-MODEL.md T-31, T-37, T-44, T-50, T-68).
#   security/redteam/tools/scan.sh <path-or-file>...          # e.g. logs/api.log ledger-dump.json fixtures/ docs/ scripts/
# Exit 1 on any hit. Mocks, tests and fixtures may contain the MockReseller form LPA:1$local.test$… and Anvil keys, so they are
# scanned with those two patterns removed; everything else gets the full list.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS="$HERE/forbidden-patterns.txt"
[[ $# -ge 1 ]] || { echo "usage: scan.sh <paths...>" >&2; exit 2; }

TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.relaxed"' EXIT
grep -v '^#' "$PATTERNS" | grep -v '^[[:space:]]*$' > "$TMP"
# relaxed list for mocks/tests/fixtures: drop the LPA-prefix rule and the Anvil key rules
grep -v -E '^(LPA:1|ac0974|59c6995e|5de4111a|test test test)' "$TMP" > "$TMP.relaxed"

status=0
for target in "$@"; do
  [[ -e "$target" ]] || { echo "scan: skip missing $target" >&2; continue; }
  while IFS= read -r -d '' file; do
    file="$(realpath "$file")"
    case "$file" in
      *node_modules/*|*/dist/*|*/.next/*|*/out/*|*.png|*.jpg|*.woff2|*.pdf|*.mp4) continue ;;
    esac
    list="$TMP"
    case "$file" in
      *mocks/*|*/test/*|*fixtures/*|*.test.ts|*.spec.ts|*/security/redteam/*|*/docs/THREAT-MODEL.md|*/scripts/dev-chain.sh|*/.env.example) list="$TMP.relaxed" ;;
    esac
    if grep -n -P -f "$list" -- "$file" > /dev/null 2>&1; then
      echo "FORBIDDEN PATTERN in $file:"
      grep -n -P -f "$list" -- "$file" | sed 's/^/    /' | cut -c1-200
      status=1
    fi
  done < <(find "$(realpath "$target")" -type f -print0)
done
[[ $status -eq 0 ]] && echo "scan: clean" || echo "scan: FAIL"
exit $status
