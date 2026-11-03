#!/usr/bin/env bash
# Prints the versions of every tool the repo needs. Exit code 1 if one is missing.
set -uo pipefail

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
# forge compiles with the static binaries under ~/.svm (binaries.soliditylang.org is blocked in the sandbox);
# a `solc` on PATH may be a solc-select wrapper that downloads on demand, so prefer the seeded binary.
if [[ -x "$HOME/.svm/0.8.30/solc-0.8.30" ]]; then
  printf '%-6s %s\n' solc "$("$HOME/.svm/0.8.30/solc-0.8.30" --version | tail -n 1)"
else
  report solc "solc --version | tail -n 1"
fi
report git "git --version"

if [[ -d "$HOME/.svm" ]]; then
  printf '%-6s %s\n' svm "$(ls "$HOME/.svm" | tr '\n' ' ')(offline forge builds use these)"
fi

exit "$missing"
