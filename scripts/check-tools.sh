#!/usr/bin/env bash
# Prints the versions of every tool the repo needs. Exit code 1 if one is missing.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../scripts/lib/gnu-path.sh" 2>/dev/null || true  # macOS GNU grep/timeout

missing=0
report() {
  local name="$1" cmd="$2"
  if command -v "${cmd%% *}" >/dev/null 2>&1; then
    printf '%-6s %s\n' "$name" "$(eval "$cmd" 2>&1 | head -n 1)"
  else
    printf '%-6s MISSING\n' "$name"
    missing=1
  fi
}

report node "node --version"
report pnpm "pnpm --version"
report forge "forge --version"
report anvil "anvil --version"
report cast "cast --version"
# forge resolves solc itself: ~/.svm (Linux sandbox) or ~/Library/Application Support/svm (macOS).
for cand in "$HOME/.svm/0.8.30/solc-0.8.30" "$HOME/Library/Application Support/svm/0.8.30/solc-0.8.30"; do
  if [[ -x "$cand" ]]; then
    printf '%-6s %s\n' solc "$("$cand" --version | tail -n 1)"
    cand=found; break
  fi
done
[[ "${cand:-}" == found ]] || report solc "solc --version | tail -n 1"
report git "git --version"

if [[ -d "$HOME/.svm" ]]; then
  printf '%-6s %s\n' svm "$(ls "$HOME/.svm" | tr '\n' ' ')(offline forge builds use these)"
fi

exit "$missing"
