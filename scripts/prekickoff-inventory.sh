#!/usr/bin/env bash
# Prints the "what exists before kickoff" table of docs/DISCLOSURE.md from git (and, with --tests, the test counts).
# Run it at the v0-prekickoff tag (Thu 5 Nov 20:59 IST) and paste the output over the table in DISCLOSURE.md:
#
#   bash scripts/prekickoff-inventory.sh                 # HEAD
#   bash scripts/prekickoff-inventory.sh v0-prekickoff   # the tag
#   bash scripts/prekickoff-inventory.sh HEAD --tests    # + vitest/forge counts (≈ 2 min). Tests run on the WORKING TREE:
#                                                        # run it on a clean checkout of the tag for the disclosure numbers
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-HEAD}"
TESTS=0
[[ "${2:-}" == "--tests" ]] && TESTS=1
cd "$ROOT"

count_tests() { # $1 = package dir → "passed (+ N open _RTFINDING)" for vitest, "passed" for forge
  local dir="$1" out
  if [[ "$dir" == packages/contracts ]]; then
    out="$(cd "$dir" && forge test --summary 2>/dev/null | awk -F'|' '/Test +\|/ && $3 ~ /[0-9]/ {p+=$3} END {print p+0}')"
    echo "$out"
  elif [[ -x "$dir/node_modules/.bin/vitest" ]]; then
    out="$(cd "$dir" && ./node_modules/.bin/vitest run --reporter=dot 2>&1 | grep -E '^ +Tests ' | tail -1)"
    out="${out#*Tests }"
    echo "${out#"${out%%[![:space:]]*}"}"
  else
    echo "n/a (dependencies not linked)"
  fi
}

echo "Snapshot: \`$(git rev-parse --short "$REF")\` ($(git log -1 --format='%cd' --date=format:'%a %d %b %Y %H:%M UTC' "$REF")), $(git rev-list --count "$REF") commits since \`$(git rev-list --max-parents=0 "$REF" | tail -1 | cut -c1-7)\`."
echo
echo "| Path | First → last commit | Commits | Tracked files | TS/Sol lines | Tests |"
echo "|---|---|---|---|---|---|"
for p in packages/protocol packages/crypto packages/eip3009 packages/octroi packages/adapters packages/contracts \
  packages/ui services/api services/agent apps/web apps/video scripts security docs research; do
  [[ -n "$(git ls-tree -d "$REF" "$p" 2>/dev/null)" ]] || continue
  first="$(git log --reverse --format='%h' "$REF" -- "$p" | awk 'NR==1')"
  last="$(git log -1 --format='%h' "$REF" -- "$p")"
  commits="$(git log --format='%h' "$REF" -- "$p" | wc -l | tr -d ' ')"
  files="$(git ls-tree -r --name-only "$REF" -- "$p" | wc -l | tr -d ' ')"
  lines="$(git ls-tree -r --name-only "$REF" -- "$p" | { grep -E '\.(ts|tsx|sol)$' || true; } | while read -r f; do git show "$REF:$f"; done | wc -l | tr -d ' ')"
  tests="—"
  if [[ "$TESTS" == 1 && "$p" =~ ^(packages|services)/ ]]; then tests="$(count_tests "$p")"; fi
  echo "| \`$p\` | \`$first\` → \`$last\` | $commits | $files | $lines | $tests |"
done
