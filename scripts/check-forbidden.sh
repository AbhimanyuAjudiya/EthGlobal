#!/usr/bin/env bash
# The forbidden-pattern gate over everything committed that may carry a secret (BUILD-PLAN §5.3, THREAT-MODEL T-50,
# T-64, T-86): a thin wrapper around the red team's scanner, security/redteam/tools/scan.sh, with its pattern list
# security/redteam/tools/forbidden-patterns.txt. CI runs it in the blocking `checks` job (RT-P-10).
#
#   bash scripts/check-forbidden.sh               # fixtures/ docs/ scripts/ research/
#   bash scripts/check-forbidden.sh apps/web/e2e  # any other paths (run-wave.sh static adds apps/web/e2e)
#   bash scripts/check-forbidden.sh fixtures      # only these paths
# Exit 0 = clean, 1 = a hit (the scanner prints file:line and the rule, never the matched value), 2 = scanner error.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
paths=("$@")
if [[ ${#paths[@]} -eq 0 ]]; then
  for p in fixtures docs scripts research; do [[ -e $p ]] && paths+=("$p"); done
fi
exec bash "$ROOT/security/redteam/tools/scan.sh" "${paths[@]}"
