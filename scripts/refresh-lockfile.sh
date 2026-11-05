#!/usr/bin/env bash
# RT-P-04: regenerate pnpm-lock.yaml for every workspace importer, then prove CI's frozen install accepts it.
# Run by a HUMAN on a machine with registry access, Thu 5 Nov afternoon IST (once the newest catalog pin is older than
# pnpm-workspace.yaml's minimumReleaseAge, ≈ 2026-11-05 08:30 UTC). Never weaken minimumReleaseAge to make it pass.
#
#   bash scripts/refresh-lockfile.sh        # install → frozen install → deps-check → git add pnpm-lock.yaml (no commit)
#
# Afterwards: review `git diff --cached pnpm-lock.yaml` (one @hiero-ledger/sdk, no banned names, versions == the
# catalog pins of RT-P-05), then commit it yourself. Every direct dependency is an exact catalog pin, so the refresh
# resolves exactly what the tests ran on; only transitive versions are new.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(date -u +%s)" -lt "$(date -u -d '2026-11-05T08:30:00Z' +%s 2>/dev/null || echo 0)" ]]; then
  echo "refresh-lockfile: before 2026-11-05 08:30 UTC the minimumReleaseAge gate (pnpm-workspace.yaml) still rejects" >&2
  echo "refresh-lockfile: the newest pins; pnpm install will fail with ERR_PNPM_* — that is expected, try again later." >&2
fi
grep -qE '^minimumReleaseAge: *[0-9]+' pnpm-workspace.yaml || { echo "refresh-lockfile: minimumReleaseAge missing" >&2; exit 1; }

pnpm install
pnpm install --frozen-lockfile
bash security/redteam/tools/deps-check.sh
git add pnpm-lock.yaml
echo "refresh-lockfile: pnpm-lock.yaml staged — review 'git diff --cached pnpm-lock.yaml', then commit it"
