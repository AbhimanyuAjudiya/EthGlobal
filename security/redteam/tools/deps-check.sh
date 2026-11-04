#!/usr/bin/env bash
# Dependency and secret hygiene gate (docs/THREAT-MODEL.md T-52, T-65, T-66, T-67). Run from anywhere; exit 1 on failure.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
fail=0
note() { echo "deps-check: $*"; }
bad()  { echo "deps-check: FAIL — $*"; fail=1; }

# 1. Lockfile is frozen-installable (what CI does); offline first, then with the registry.
if ! pnpm install --frozen-lockfile --offline > /dev/null 2>&1; then
  pnpm install --frozen-lockfile > /dev/null 2>&1 || bad "pnpm install --frozen-lockfile failed (lockfile drift)"
fi

# 2. Known vulnerabilities in production deps.
if pnpm audit --prod --audit-level=high > /tmp/recharge-audit.txt 2>&1; then
  note "pnpm audit --prod: clean"
else
  if grep -q -i 'ENOTFOUND\|ECONN\|network' /tmp/recharge-audit.txt; then note "pnpm audit skipped (registry unreachable)"; else bad "pnpm audit --prod reports high/critical advisories (see /tmp/recharge-audit.txt)"; fi
fi

# 3. Postinstall scripts allow-list unchanged (pnpm-workspace.yaml onlyBuiltDependencies).
allowed_built="esbuild"
actual_built="$(awk '/onlyBuiltDependencies:/{f=1;next} /^[^ ]/{f=0} f && /^ *- /{gsub(/^ *- /,"");print}' pnpm-workspace.yaml | tr '\n' ' ' | sed 's/ *$//')"
[[ "$actual_built" == "$allowed_built" ]] || bad "onlyBuiltDependencies changed: '$actual_built' (allowed: '$allowed_built') — file a finding before accepting a new postinstall script"

# 4. minimumReleaseAge recommended (T-65).
grep -q 'minimumReleaseAge' pnpm-workspace.yaml || note "WARN: pnpm-workspace.yaml has no minimumReleaseAge (recommend 3 days = 4320)"

# 5. No unpinned npx in scripts or package.json scripts.
if grep -R -n -E 'npx +[a-z@][^ ]*' --exclude-dir=node_modules --include='*.sh' --include='package.json' --include='*.ts' scripts package.json apps/*/package.json packages/*/package.json services/*/package.json 2>/dev/null | grep -v -E 'npx +[^ ]+@[0-9]' ; then
  bad "unpinned npx invocation(s) above — pin an exact version"
fi

# 6. Secrets hygiene. (packages/adapters/src/testing is the one sanctioned home of the public Anvil keys — wave3-ops.)
git ls-files --error-unmatch .env > /dev/null 2>&1 && bad ".env is tracked by git"
if git grep -n -E 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' -- . ':!scripts/dev-chain.sh' ':!packages/adapters/src/testing/**' ':!**/test/**' ':!**/fixtures/**' ':!**/*.test.ts' ':!security/**' ':!docs/**' ':!research/**' ':!**/mocks/**'; then
  bad "Anvil account #0 private key outside dev tooling/tests (lines above; docs may quote it, code may not)"
fi
if git grep -n -E '(PRIVATE_KEY|SECRET|MNEMONIC)[A-Z_]*=[^$<]{8,}' -- . ':!.env.example' ':!security/**' ':!docs/**' ':!research/**' > /dev/null; then
  bad "secret-looking assignment committed (see git grep output)"
fi

# 7. Banned / deprecated vendor packages never resolve (T-65; INTERFACES A-19, A-22, A-23, A-25): one Hedera SDK, no v1 x402.
if [[ -f pnpm-lock.yaml ]]; then
  banned="$(grep -oE "^  '?/?(@hashgraph/sdk|hedera-agent-kit|golem-base-sdk|@worldcoin/idkit-standalone|x402|x402-(hono|fetch|express|next|axios))@[0-9][^:']*" pnpm-lock.yaml | sort -u)"
  [[ -z "$banned" ]] || bad "banned/deprecated packages in the lockfile: $(echo $banned)"
  hiero="$(grep -oE "^  '?/?@hiero-ledger/sdk@[0-9][^(:']*" pnpm-lock.yaml | sort -u | wc -l)"
  [[ "$hiero" -le 1 ]] || bad "more than one @hiero-ledger/sdk version in the lockfile ($hiero) — instanceof breaks across copies"
fi

# 8. Foundry libs pinned and present (T-66).
grep -q 'forge-std@v1.17.0' packages/contracts/package.json && grep -q 'openzeppelin-contracts@v5.7.0' packages/contracts/package.json || bad "Foundry library pins changed in packages/contracts/package.json"
if [[ -x "$HOME/.svm/0.8.30/solc-0.8.30" ]]; then note "solc 0.8.30 sha256: $(sha256sum "$HOME/.svm/0.8.30/solc-0.8.30" | cut -c1-16)…"; fi

[[ $fail -eq 0 ]] && note "OK" || note "FAILED"
exit $fail
