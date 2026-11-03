#!/usr/bin/env bash
# Coverage gate for docs/THREAT-MODEL.md §5.12 (PLAN §1 pass criterion).
#   security/redteam/tools/coverage-check.sh                       # structure: every Critical/High threat is in the matrix and
#                                                                   # every attack reference resolves to a step heading
#   security/redteam/tools/coverage-check.sh --require <prefix>...  # also: every regression path under these prefixes exists
#       e.g. --require packages/contracts packages/octroi           (run-wave.sh passes the wave's packages)
# Exit 0 = covered, 1 = gaps (listed), 2 = usage/parse error. Pure bash + grep -P + awk.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TM="$ROOT/docs/THREAT-MODEL.md"
ATTACKS="$ROOT/security/redteam/attacks"
require=()
if [[ "${1:-}" == "--require" ]]; then shift; require=("$@"); fi
[[ -r "$TM" ]] || { echo "coverage: $TM missing" >&2; exit 2; }
grep -q '<!-- coverage:begin -->' "$TM" && grep -q '<!-- coverage:end -->' "$TM" || { echo "coverage: §5.12 markers missing" >&2; exit 2; }

fail=0
gap() { echo "coverage: GAP — $*"; fail=1; }

# 1. Critical/High threats declared in the tables (everything before §5.12)
declared="$(awk '/^### 5\.12/{exit} {print}' "$TM" \
  | grep -oP '^\| \KT-\d+(?= \|.*?\| (Critical|High) \| [HML] \|)' | sort -u)"
[[ -n "$declared" ]] || { echo "coverage: no Critical/High rows parsed" >&2; exit 2; }

# 2. matrix rows
matrix="$(awk '/<!-- coverage:begin -->/{f=1;next} /<!-- coverage:end -->/{f=0} f' "$TM" | grep -P '^\| T-\d+ \|')"
in_matrix="$(printf '%s\n' "$matrix" | grep -oP '^\| \KT-\d+' | sort -u)"
for t in $(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$in_matrix")); do gap "$t is Critical/High but has no row in §5.12"; done

declare -A sev_of=()
while IFS= read -r t; do
  s="$(awk '/^### 5\.12/{exit} {print}' "$TM" | grep -oP "^\| $t \|.*?\| \K(Critical|High|Med|Low)(?= \| [HML] \|)" | head -1)"
  sev_of[$t]="$s"
done < <(printf '%s\n' "$in_matrix")

checked_refs=0; checked_paths=0; required_paths=0
while IFS= read -r row; do
  IFS='|' read -r _ t sev refs paths _ <<< "$row"
  t="$(echo "$t" | xargs)"; sev="$(echo "$sev" | xargs)"; refs="$(echo "$refs" | xargs)"; paths="$(echo "$paths" | xargs)"
  [[ "${sev_of[$t]:-}" == "$sev" ]] || gap "$t: matrix says '$sev', table says '${sev_of[$t]:-absent}'"
  [[ -n "$refs" ]] || gap "$t: no attack step"
  [[ -n "$paths" ]] || gap "$t: no regression path"
  # attack refs: "file.md S1, S2; other.md S3"
  IFS=';' read -ra groups <<< "$refs"
  for g in "${groups[@]}"; do
    g="$(echo "$g" | xargs)"; file="${g%% *}"; steps="${g#* }"
    [[ -f "$ATTACKS/$file" ]] || { gap "$t: attack file $file missing"; continue; }
    IFS=',' read -ra ss <<< "$steps"
    for st in "${ss[@]}"; do
      st="$(echo "$st" | xargs)"; checked_refs=$((checked_refs+1))
      grep -qP "^(#{2,4} +|\*\*)${st}(?![0-9A-Za-z])" "$ATTACKS/$file" || gap "$t: step '$st' not found in $file"
    done
  done
  # regression paths: "a; b"
  IFS=';' read -ra ps <<< "$paths"
  for p in "${ps[@]}"; do
    p="$(echo "$p" | xargs)"; checked_paths=$((checked_paths+1))
    [[ "$p" =~ /test/regression/|/e2e/regression/ ]] || gap "$t: regression path '$p' is not under test/regression/ or e2e/regression/"
    base="$(basename "$p")"
    [[ "$base" == *"${t//-/}"* || "$base" == *"$t"* ]] || gap "$t: regression file '$base' is not named after the threat id"
    for pre in "${require[@]}"; do
      if [[ "$p" == "$pre"/* ]]; then
        required_paths=$((required_paths+1))
        [[ -f "$ROOT/$p" ]] || gap "$t: regression test missing: $p (builder of $pre must create it)"
      fi
    done
  done
done < <(printf '%s\n' "$matrix")

n_decl="$(printf '%s\n' "$declared" | wc -l)"
if [[ $fail -eq 0 ]]; then
  echo "coverage: OK — $n_decl Critical/High threats mapped; $checked_refs attack steps resolve; $checked_paths regression paths named; $required_paths required paths present"
else
  echo "coverage: FAIL"
fi
exit $fail
