#!/usr/bin/env bash
# The design-ban gate (BUILD-PLAN §2.4, web.md): the "design bans (CI grep)" suite of packages/ui/tokens.test.ts scans
# the component and app sources for the banned tells and proves on a planted sample that the grep itself fires.
# run-wave.sh 3 calls this file; a missing file there is a failure, not a skip (RT-P-09).
#
#   bash scripts/check-design-bans.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITEST="$ROOT/packages/ui/node_modules/.bin/vitest"
[[ -x "$VITEST" ]] || { echo "check-design-bans: $VITEST missing (install packages/ui dependencies)" >&2; exit 2; }
cd "$ROOT/packages/ui"
exec "$VITEST" run tokens.test.ts -t 'design bans'
