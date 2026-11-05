#!/usr/bin/env bash
# Offline self-test for security/redteam/tools/semgrep/recharge.yml.
#   security/redteam/tools/semgrep/selftest.sh        # exit 0 = every rule parses, fires on its positives, stays quiet on its negatives
#
# Why: `semgrep --validate` downloads p/semgrep-rule-lints from semgrep.dev (blocked here). A rule file that does not parse makes
# a normal scan exit 7; a rule that parses but never matches is just as useless, so this script also proves behaviour.
# The corpus is generated into a temp dir at run time (a committed corpus of deliberately bad .ts would break `eslint .`).
# Markers: a line `// ruleid: <id>` (or `# ruleid:`) expects <id> to fire on the NEXT line; `// ok: <id>` expects it not to.
# Needs: semgrep, jq.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="$HERE/recharge.yml"
command -v semgrep >/dev/null || { echo "selftest: semgrep missing (pip3 install semgrep)" >&2; exit 2; }
command -v jq >/dev/null || { echo "selftest: jq missing" >&2; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
w() { mkdir -p "$T/$(dirname "$1")"; cat > "$T/$1"; }
AK='ac0974bec39a17e36ba4a6b4d238ff944bacb478''cbed5efcae784d7bf4f2ff80'   # split so this script is not itself a hit
LP='LPA:1$smdp''.carrier.com$K2-ABCD-EFGH'

w packages/octroi/src/units.ts <<'EOF'
import { parseEther } from 'viem';
// ruleid: recharge-usdc-18-decimals
export const wrong = parseEther('0.5');
// ruleid: recharge-usdc-18-decimals
export const alsoWrong = 5n * 10n ** 18n;
// ok: recharge-usdc-18-decimals
export const right = 500_000n;
// ruleid: recharge-math-random-for-secrets
export const nonce = Math.random();
EOF

w apps/web/components/Name.tsx <<'EOF'
export function Name({ n }: { n: string }) {
  // ruleid: recharge-no-dangerous-html
  return <span dangerouslySetInnerHTML={{ __html: n }} />;
}
export function save(lpa: string) {
  // ruleid: recharge-secret-in-browser-storage
  localStorage.setItem('openedLpa', lpa);
  // ok: recharge-secret-in-browser-storage
  localStorage.setItem('a2hs-dismissed', '1');
}
// ruleid: recharge-rp-signing-key-in-client
const k = process.env.RP_SIGNING_KEY;
// ruleid: recharge-next-public-secret
const t = process.env.NEXT_PUBLIC_PRINT_TOKEN;
// ok: recharge-next-public-secret
const api = process.env.NEXT_PUBLIC_API_URL;
EOF

w services/api/src/routes/webhooks.ts <<'EOF'
export const route = (app: any, reseller: any) => app.post('/webhooks/reseller/:p', async (c: any) => {
  // ok: recharge-webhook-must-read-raw-body
  const raw = await c.req.raw.text();
  // ruleid: recharge-webhook-must-read-raw-body
  const body = await c.req.json();
  return reseller.verifyWebhook(raw, c.req.raw.headers, Date.now(), body);
});
EOF

w services/api/src/routes/card.ts <<'EOF'
export const route = (app: any, gifts: any) => {
  app.get('/card/:serial', async (c: any) => {
    // ruleid: recharge-mutation-inside-get-handler
    await gifts.markClaimed(c.req.param('serial'));
    return c.json({});
  });
  app.post('/card/redeem', async (c: any) => {
    // ok: recharge-mutation-inside-get-handler
    await gifts.markClaimed('x');
    return c.json({});
  });
};
EOF

w services/api/src/routes/seed.ts <<'EOF'
export const seed = (c: any, env: any) => {
  // ruleid: recharge-seed-hook-without-local-guard
  const v = c.req.header('X-Seed-Validity-S');
  if (env.MODE === 'local') {
    // ok: recharge-seed-hook-without-local-guard
    const w = c.req.header('X-Seed-Claim-Window-S');
    return [v, w];
  }
  return [v];
};
EOF

w services/agent/src/loop.ts <<'EOF'
// ruleid: recharge-agent-decision-path-imports-inference
import { Inference } from '@ethglobal/adapters';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
// ok: recharge-agent-llm-holds-transfer-tools
const mode = AgentMode.AUTONOMOUS;
// ruleid: recharge-agent-llm-holds-transfer-tools
const tk = new HederaLangchainToolkit({ client, configuration: { context: { mode } } });
// ruleid: recharge-no-console-log-in-services
console.log(mode, tk);
// ruleid: recharge-no-eval
eval('1');
export { Inference };
EOF

w packages/protocol/src/x402.ts <<'EOF'
// ruleid: recharge-x402-v1-primitive
export const H = 'X-PAYMENT';
// ruleid: recharge-x402-v1-primitive
export const req = { maxAmountRequired: '10000' };
// ruleid: recharge-x402-v1-primitive
export const net = 'base-sepolia';
// ruleid: recharge-x402-v1-primitive
export const hed = 'hedera:296';
// ok: recharge-x402-v1-primitive
export const ok = ['PAYMENT-SIGNATURE', 'eip155:84532', 'hedera:testnet'];
EOF

w packages/adapters/src/live/world.ts <<'EOF'
// ruleid: recharge-world-id-legacy-primitive
export const legacy = 'https://developer.worldcoin.org/api/v2/verify/app_x';
// ok: recharge-world-id-legacy-primitive
export const current = 'https://developer.world.org/api/v4/verify/rp_x';
EOF

w packages/adapters/src/live/arkiv.ts <<'EOF'
// ruleid: recharge-arkiv-legacy-primitive
import { createClient } from 'golem-base-sdk';
// ruleid: recharge-arkiv-legacy-primitive
export const o = { btl: 302400 };
// ruleid: recharge-arkiv-legacy-primitive
export const f = { flags: { permissionlessExtension: true } };
// ok: recharge-arkiv-legacy-primitive
export const e = { expiration: 'ExpirationTime.fromSeconds(600)' };
// ruleid: recharge-arkiv-legacy-primitive
export const chain = { id: 60_138_453_025 };
// ruleid: recharge-arkiv-legacy-primitive
export const use = { chainId: KAOLIN_CHAIN_ID };
// ruleid: recharge-arkiv-legacy-primitive
export const rpc = 'https://kaolin.hoodi.arkiv.network/rpc';
// ok: recharge-arkiv-legacy-primitive
import { KAOLIN_CHAIN_ID, RABDI_CHAIN_ID } from './arkiv-sdk.js';
// ok: recharge-arkiv-legacy-primitive
if (env.chainId === KAOLIN_CHAIN_ID) throw new Error('ARKIV_CHAIN_ID 60138453025 is Kaolin, which is retired: use rabdi');
/**
 * ok: recharge-arkiv-legacy-primitive
 * Kaolin (60138453025) is refused here.
 */
export { createClient, RABDI_CHAIN_ID };
EOF

w packages/adapters/src/live/hcs.ts <<'EOF'
// ruleid: recharge-hedera-legacy-primitive
import { Client } from '@hashgraph/sdk';
// ok: recharge-hedera-legacy-primitive
import { TopicId } from '@hiero-ledger/sdk';
// ruleid: recharge-hedera-legacy-primitive
export const k = (s: string) => PrivateKey.fromString(s);
// ok: recharge-hedera-legacy-primitive
export const k2 = (s: string) => PrivateKey.fromStringECDSA(s);
export { Client, TopicId };
EOF

w packages/adapters/src/defaults.ts <<EOF
// ruleid: recharge-anvil-key-literal-outside-dev-tooling
export const DEFAULT_KEY = '0x${AK}';
EOF

w apps/web/README.md <<'EOF'
<!-- ok: recharge-rp-signing-key-in-client -->
`@worldcoin/idkit-server` is aliased to a throwing stand-in for the browser (RT-W-11).
EOF

w docs/example.md <<EOF
<!-- ruleid: recharge-lpa-literal-in-source -->
The code was ${LP} in the log.
<!-- ok: recharge-lpa-literal-in-source -->
Template only: LPA:1\$<smdp>\$<matching-id>, mock LPA:1\$local.test\$0001, LPA:1\$smdp.example\$ABC-123.
EOF

# --- run (a rule-file parse error exits 7 here) ---------------------------------------------------------------------------
set +e
(cd "$T" && semgrep --config "$RULES" --json --metrics=off --disable-version-check --quiet . > "$T/.out.json" 2> "$T/.err")
rc=$?
set -e
if [[ $rc -ne 0 && $rc -ne 1 ]]; then echo "selftest: semgrep exited $rc (rule file invalid?)"; cat "$T/.err"; exit 2; fi
jq -e '.errors | length == 0' "$T/.out.json" >/dev/null || { echo "selftest: semgrep reported errors:"; jq '.errors' "$T/.out.json"; exit 2; }
jq -r '.results[] | "\(.path):\(.start.line):\(.check_id | split(".") | last)"' "$T/.out.json" | sed 's#^\./##' | sort -u > "$T/.got"

: > "$T/.marks"
while IFS= read -r -d '' f; do
  rel="${f#"$T/"}"
  awk -v p="$rel" 'match($0, /(ruleid|ok): *recharge-[a-z0-9-]+/) { m = substr($0, RSTART, RLENGTH); split(m, a, /: */); print a[1] " " p ":" NR+1 ":" a[2] }' "$f" >> "$T/.marks"
done < <(find "$T" -type f ! -name '.*' -print0)
awk '$1 == "ruleid" { print $2 }' "$T/.marks" > "$T/.want"; awk '$1 == "ok" { print $2 }' "$T/.marks" > "$T/.deny"
sort -u -o "$T/.want" "$T/.want"; sort -u -o "$T/.deny" "$T/.deny"

fail=0
missing="$(comm -23 "$T/.want" "$T/.got")"; [[ -z "$missing" ]] || { echo "selftest: expected findings NOT reported:"; echo "$missing" | sed 's/^/  /'; fail=1; }
false_pos="$(comm -12 "$T/.deny" "$T/.got")"; [[ -z "$false_pos" ]] || { echo "selftest: false positives on ok: lines:"; echo "$false_pos" | sed 's/^/  /'; fail=1; }
untested="$(comm -23 <(grep -E '^  - id: ' "$RULES" | sed 's/.*id: //' | sort -u) <(cut -d: -f3 "$T/.want" | sort -u))"
[[ -z "$untested" ]] || { echo "selftest: rules with no positive case:"; echo "$untested" | sed 's/^/  /'; fail=1; }
n_rules="$(grep -cE '^  - id: ' "$RULES")"
[[ $fail -eq 0 ]] && echo "selftest: OK — $n_rules rules parse; $(wc -l < "$T/.want") positives fire; $(wc -l < "$T/.deny") negatives quiet" || echo "selftest: FAIL"
exit $fail
