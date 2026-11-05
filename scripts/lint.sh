#!/usr/bin/env bash
# ESLint per workspace directory, one process each: typescript-eslint's projectService keeps every package's type
# program alive for the life of the process, and one `eslint .` over the whole monorepo passes 8 GB of heap since the
# wagmi/viem types arrived (each directory alone stays under 1.6 GB).
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
for d in apps/* packages/* services/* scripts security; do
  [[ -d $d ]] || continue
  npx eslint "$d" --max-warnings 0 || fail=1
done
# root-level files (eslint.config.ts, vitest.workspace, …)
npx eslint --max-warnings 0 --no-error-on-unmatched-pattern ./*.ts ./*.mjs ./*.js || fail=1
exit $fail
