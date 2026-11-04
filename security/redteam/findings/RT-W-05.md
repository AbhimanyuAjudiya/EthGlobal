---
id: RT-W-05
title: 'MODE=local: /api/demo-wallet is a cross-origin signing and Anvil-RPC oracle — a text/plain no-cors POST from any loopback/LAN page makes Anvil #3/#5/#9 send transactions and runs anvil_* cheat methods'
module: apps/web/app/api/demo-wallet/route.ts; scripts/dev-chain.sh (Anvil CORS)
threat: T-85
severity: Low
likelihood: M
status: fixed
found_by: redteam-wave3-web
owner: builder-web (route), builder-ops-demo (dev-chain.sh)
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-console-and-sw.spec.ts::a cross-origin no-cors POST cannot drive /api/demo-wallet; apps/web/test/redteam/rt-console-and-sw.spec.ts::/api/demo-wallet refuses anvil_/evm_ cheat methods
regression_test: apps/web/test/redteam/rt-console-and-sw.spec.ts::a cross-origin no-cors POST cannot drive /api/demo-wallet; apps/web/test/redteam/rt-console-and-sw.spec.ts::/api/demo-wallet refuses anvil_/evm_ cheat methods; apps/web/test/redteam/rt-console-and-sw.spec.ts::demo wallet GET exposes no key material
fix_commit: (uncommitted: wave-3 web fix pass in the working tree; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-console-and-sw -g "demo-wallet"
curl -s -X POST 127.0.0.1:3000/api/demo-wallet -H 'content-type: text/plain' -H 'Origin: https://evil.example' \
  --data '{"role":"sponsor","method":"anvil_nodeInfo"}'          # 200, full node info
```

1. A page on another origin (`http://127.0.0.1:9999/evil.html`) runs
   `fetch('http://127.0.0.1:3000/api/demo-wallet', {method:'POST', mode:'no-cors', headers:{'content-type':'text/plain'},
body: JSON.stringify({role:'sponsor', method:'eth_sendTransaction', params:[{to, value:'0x1'}]})})` → Anvil #3's
   nonce moves. The route checks neither `Origin`/`Sec-Fetch-Site` nor `content-type: application/json`.
2. Any method not in the switch is proxied to Anvil: `anvil_nodeInfo` answers 200; `anvil_setBalance`,
   `anvil_setStorageAt`, `evm_increaseTime`, `anvil_reset` go through the same `default:` branch.
3. Same class, outside apps/web: Anvil itself answers `Access-Control-Allow-Origin: *` with unlocked dev accounts
   (`dev-chain.sh` does not pass `--no-cors`), so the route is not the only door.
4. Chromium's local-network checks blocked the request from a route-fulfilled ("public") page in the test; a real
   loopback/LAN page, Firefox or Safari are not blocked. MODE=live: the route answers 404 (verified, part 3 of run.sh).

## Impact

Demo integrity on the laptop judges watch (same class as RT-P-01): any page opened during the demo can pause the
sponsor's campaign, drain the demo wallets' USDC, or `evm_increaseTime` every plan into "expired". Local money only, hence
Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In `route.ts`: refuse unless `request.headers.get('sec-fetch-site') === 'same-origin'` (fallback: `Origin` equals the
app's own origin) **and** `content-type` is `application/json`; replace the `default:` passthrough with an allow-list
(`eth_chainId, eth_blockNumber, eth_getBalance, eth_call, eth_estimateGas, eth_getTransactionReceipt, eth_getBlockByNumber,
eth_getTransactionCount, eth_gasPrice, eth_maxPriorityFeePerGas, eth_feeHistory`). In `scripts/dev-chain.sh`: pass
`--no-cors` (the PWA reaches Anvil through viem `http()`; check the reader still works, else allow only the PWA origin via
a tiny proxy).

## Builder notes

`app/api/demo-wallet/route.ts`: refuses (403) unless `Sec-Fetch-Site: same-origin` (without that header, `Origin` must equal the app's own origin/host), refuses (415) anything but `application/json`, and the `default:` passthrough is an allow-list of reads (`eth_chainId, eth_blockNumber, eth_getBalance, eth_call, eth_estimateGas, eth_getTransactionReceipt, eth_getTransactionByHash, eth_getBlockByNumber, eth_getTransactionCount, eth_gasPrice, eth_maxPriorityFeePerGas, eth_feeHistory`); anything else is `-32601`. **Not changed:** `scripts/dev-chain.sh --no-cors` (owner builder-ops-demo) — the PWA's local reader still calls Anvil from the browser, so Anvil's `ACAO: *` needs the reader moved behind a same-origin proxy first; handed back to ops.
