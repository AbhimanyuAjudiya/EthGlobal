# Vendor API fact sheet (verified 3 Nov 2026)

Purpose: builder agents in this sandbox cannot reach any vendor host, so every live adapter must be
written against the shapes below, not from memory. Everything here was verified today against a
primary source (an official repo at a pinned commit, or the npm registry); anything else is marked
**[unverified]**. Sources are given as `repo@commit:path` or a URL. Clones live under
`/tmp/claude-0/-home-user-EthGlobal/499066e2-1211-51f0-a547-9a48c193966a/scratchpad/vendor/` for this
session only.

Network note for whoever repeats this: in this cloud session only `github.com`, the npm registry and
web search resolve. `docs.hedera.com`, `docs.esimaccess.com`, `docs.arkiv.network`, `docs.world.org`,
`x402.org`, `blocky402.com`, `hedera.com` and `esimaccess.com` are DNS-blocked, so docs were read from
their GitHub source repos (`hashgraph/hedera-docs`, `worldcoin/developer-docs`) and from unpacked npm
tarballs (`npm pack`).

Sources pinned in this sheet

| Source | Pin |
| --- | --- |
| `coinbase/x402` (the spec text now calls itself `x402-foundation/x402`) | `0e6e8c55d86b4f14234fb6e49a4052074fb93e57` (15 Oct 2026); repo packages at 2.28.0, npm at **2.29.0** (28 Oct 2026) |
| `hashgraph/hedera-docs` (source of docs.hedera.com) | `836b856` |
| `hashgraph/hedera-agent-kit` (README calls it `hedera-agent-kit-js`) | `f3d27aeb7040b8f592ec3038737d7229df63b0b0` (30 Oct 2026) |
| `hashgraph-online/standards-sdk` | `04f97c87da6061a9fb3b00e2590444d3412eff7f` (19 Oct 2026) |
| `Arkiv-Network/db-chain-networks` | `8af442e9e1f0361343189fb1fc058ce80ac26728` (30 Oct 2026) |
| `worldcoin/developer-docs` (source of docs.world.org) | `b07e972767874a0252c70b006b51e3b1e5dfe2fc` (30 Oct 2026) |
| `worldcoin/idkit-js` (legacy v2 line only) | `bd8ea11510afacf5c9b16220c97765a68e6fa57b` (14 Apr 2026) |
| `esimaccess/esimaccess-api` (official "agent skill" with API reference) | `b9421b3` (15 Apr 2026) |
| `ensdomains/ens-contracts` (deployments/) | `ebe0b84` |
| `circlefin/stablecoin-evm` (contracts/v2) | `fc85788bc7c23cefe3df1a757133048bfddadeaa` (12 Aug 2026) |
| `ethersphere/bee` (openapi/) | `ed32cfa` (2 Nov 2026) |
| npm tarballs | `@x402/core|evm|hedera|hono|fetch@2.29.0`, `@coinbase/x402@2.1.0`, `@arkiv-network/sdk@1.0.1`, `@hashgraph/hedera-agent-kit@4.2.0`, `@worldcoin/idkit@4.6.0`, `@worldcoin/idkit-core@4.6.0`, `@worldcoin/agentkit@0.2.1`, `viem@2.57.15` |

---

## 1. x402 v2

### 1.1 Packages (npm, queried 3 Nov 2026)

| Package | Version | Notes |
| --- | --- | --- |
| `@x402/core` | 2.29.0 | subpaths: `.`, `./client`, `./facilitator`, `./http`, `./server`, `./types`, `./types/v1`, `./utils`, `./schemas` |
| `@x402/evm` | 2.29.0 | deps `viem ^2.48.11`, `zod ^4.6.6`; subpaths `./exact/client`, `./exact/server`, `./exact/facilitator`, `./v1`, plus `upto`, `batch-settlement`, `auth-capture` |
| `@x402/hedera` | 2.29.0 | deps `@hiero-ledger/sdk 2.90.1`, `@hiero-ledger/proto 2.32.0`; subpaths `./exact/client`, `./exact/server`, `./exact/facilitator`; re-exports `AccountId, Client, PrivateKey, TokenAssociateTransaction, TokenId, TransferTransaction, ...` so you use ONE SDK instance |
| `@x402/hono` | 2.29.0 | peer `hono >=4.13.7 <5`, `@x402/paywall ^2.29.0`; deps `@x402/core`, `@x402/extensions` |
| `@x402/fetch`, `@x402/axios`, `@x402/express`, `@x402/next`, `@x402/fastify`, `@x402/paywall`, `@x402/extensions`, `@x402/mcp`, `@x402/svm` | 2.29.0 | all released together |
| `x402`, `x402-hono`, `x402-fetch`, `x402-express`, `x402-next` | 1.2.0 (`x402-axios` 1.2.1) | **legacy v1** line (last published 16 Apr 2026); v1 has NO Hedera network |
| `@coinbase/x402` | 2.1.0 | CDP facilitator config (see 1.6) |

Install for this product: `pnpm add @x402/core @x402/hono @x402/evm @x402/hedera @x402/fetch viem`.
Source: `npm view`; `x402@0e6e8c5:typescript/packages/*/package.json`; tarball `package.json` exports.

### 1.2 HTTP transport headers (v2)

| Header | Direction | Content |
| --- | --- | --- |
| `PAYMENT-REQUIRED` | server -> client, with HTTP **402** | base64(JSON `PaymentRequired`) |
| `PAYMENT-SIGNATURE` | client -> server | base64(JSON `PaymentPayload`) |
| `PAYMENT-RESPONSE` | server -> client (200 on success, 402 on failure) | base64(JSON `SettlementResponse`) |
| `EXTENSION-RESPONSES` | facilitator -> resource server only (sidechannel, never forwarded to buyers) | base64(JSON keyed by extension name) |

Status mapping: 402 payment required / payment failed, 400 malformed payload, 500 server error, 200 success.
Response bodies are implementation-defined; all protocol data is in headers.
Legacy v1 used `X-PAYMENT` and `X-PAYMENT-RESPONSE` and plain network names (`base-sepolia`); do not mix.
(The hedera-docs "Pay with x402" page still says "`X-Payment` header (or equivalent)"; the spec and SDK use `PAYMENT-SIGNATURE`.)
Source: `x402@0e6e8c5:specs/transports-v2/http.md`, `specs/transports-v1/http.md`, `specs/x402-specification-v2.md` §7.2.1.

### 1.3 `PaymentRequired` and `accepts[]` (PaymentRequirements)

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": { "url": "https://api.example.com/premium-data", "description": "...", "mimeType": "application/json",
                "serviceName": "<=32 ASCII", "tags": ["<=5 x <=32 ASCII"], "iconUrl": "https://..." },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USDC", "version": "2" }
  }],
  "extensions": {}
}
```

Field rules (spec §5.1.2): `x402Version` (must be 2), `resource.url` required; each `accepts[]` item has
`scheme`, `network` (CAIP-2 `namespace:reference`), **`amount`** (atomic units, string; v1 called this
`maxAmountRequired`, v2 renamed it), `asset` (token contract address, HTS id, or ISO-4217 code), `payTo`,
`maxTimeoutSeconds` (number), optional `extra`. Reserved `extra` keys: `assetTransferMethod`
(`eip3009` default on EVM, `permit2`, `erc7710`; `cryptoTransfer` default on Hedera, `transferExecutor`)
and `paymentFlow` (`authorization` default = verify -> resource -> settle; `upfront`; `escrow`).
EVM `exact`+EIP-3009 requires `extra.name` and `extra.version` = the token's EIP-712 domain.
Hedera `exact` requires `extra.feePayer` (facilitator account id).
Source: `specs/x402-specification-v2.md` §5–6, `specs/schemes/exact/scheme_exact_evm.md`, `scheme_exact_hedera.md`.

### 1.4 `PaymentPayload` and the `exact` EVM payload (EIP-3009)

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepted": { /* the chosen PaymentRequirements object, echoed */ },
  "payload": {
    "signature": "0x<65-byte EIP-712 signature>",
    "authorization": {
      "from": "0x857b...", "to": "0x2096...", "value": "10000",
      "validAfter": "1740672089", "validBefore": "1740672154",
      "nonce": "0xf374...13480"   /* random 32 bytes */
    }
  },
  "extensions": {}
}
```

Typed data the client signs (`@x402/evm` `authorizationTypes`, `mechanisms/evm/src/constants.ts:49`):
`domain = { name: extra.name, version: extra.version, chainId: <eip155 reference>, verifyingContract: asset }`,
`primaryType = "TransferWithAuthorization"`, types
`TransferWithAuthorization: [from address, to address, value uint256, validAfter uint256, validBefore uint256, nonce bytes32]`.
Client sets `validBefore = now + maxTimeoutSeconds` (`mechanisms/evm/src/exact/client/eip3009.ts:29`).
Facilitator settles by calling `transferWithAuthorization(...)` on the token. Permit2 fallback uses canonical
`x402ExactPermit2Proxy` `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` (same address on all chains via CREATE2).

### 1.5 Facilitator interface

- `POST /verify` body `{ "x402Version": 2, "paymentPayload": <PaymentPayload>, "paymentRequirements": <PaymentRequirements> }`
  -> `{ "isValid": true, "payer": "0x..." }` or `{ "isValid": false, "invalidReason": "insufficient_funds", "payer": "0x..." }`
  (`VerifyResponse`: `isValid`, `invalidReason?`, `payer?`, `extensions?`, `extra?`). `/verify` is read-only.
- `POST /settle` same body -> `SettlementResponse`
  `{ "success": true, "transaction": "0x<hash>", "network": "eip155:84532", "payer": "0x..." }` /
  `{ "success": false, "errorReason": "insufficient_funds", "transaction": "", "network": "...", "payer": "..." }`;
  optional `amount`, `extensions`. `errorReason: "settlement_pending"` is non-terminal and MUST carry the tx hash.
- `GET /supported` -> `{ "kinds": [{ "x402Version": 2, "scheme": "exact", "network": "eip155:84532", "extra"?: {...} }], "extensions": [], "signers": { "eip155:*": ["0x..."], "solana:*": ["..."] } }`.
  Hedera kinds carry the fee payer in `extra` (hedera-docs: "along with the fee-payer account the facilitator will sponsor").
- `GET /discovery/resources?type=http&payTo=&scheme=&network=&limit=&offset=` (Bazaar).
- Error codes (§9): `insufficient_funds`, `invalid_exact_evm_payload_authorization_valid_after`,
  `..._valid_before`, `..._value_mismatch`, `invalid_exact_evm_payload_signature`,
  `invalid_exact_evm_payload_recipient_mismatch`, `invalid_network`, `invalid_payload`,
  `invalid_payment_requirements`, `invalid_scheme`, `unsupported_scheme`, `invalid_x402_version`,
  `invalid_transaction_state`, `unexpected_verify_error`, `unexpected_settle_error`, `settlement_pending`.
Source: `specs/x402-specification-v2.md` §5.3–5.4, §7, §9; `@x402/core@2.29.0 dist` types `SupportedResponse`.

### 1.6 Public facilitators

| Facilitator | URL | Networks relevant to us | Auth |
| --- | --- | --- | --- |
| x402.org (default in `@x402/core` `HTTPFacilitatorClient`, `core/src/http/httpFacilitatorClient.ts:14`) | `https://x402.org/facilitator` (`/supported`, `/verify`, `/settle`) | `eip155:84532` Base Sepolia (all SDK READMEs use it); `hedera:testnet`, advertised fee payer `0.0.9185802` (hedera-docs) | none |
| Coinbase CDP (`@coinbase/x402@2.1.0`) | `https://api.cdp.coinbase.com/platform/v2/x402` (`list` open; `verify`/`settle` need `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`) | Base mainnet/sepolia [which networks exactly: unverified] | CDP key |
| Blocky402 | testnet `https://api.testnet.blocky402.com`, mainnet `https://api.blocky402.com` | `hedera:testnet` fee payer `0.0.7162784`; `hedera:mainnet` `0.0.10571514` | none |
| Launa | testnet `https://testnet.facilitator.launa.dev`; mainnet dedicated `https://<subdomain>.facilitator.launa.dev` after free signup | `hedera:testnet` fee payer `0.0.9839454`; mainnet `0.0.10789914` | none (testnet) |
| amnt (open source, `BelgacemElbar/amnt-x402-facilitator`) | testnet `https://testnet.facilitator.amnt.io`, mainnet `https://facilitator.amnt.io` | Hedera, Base Sepolia, Solana devnet (README) | none |
| Ax402 | `https://testnet.facilitator.ax402.io` **[unverified]** — only in an unmerged hedera-docs PR (#742); not on the current facilitators page | | |
| World Chain (from World AgentKit docs) | `https://x402-worldchain.vercel.app/facilitator` | `eip155:480` | none stated |

Hedera-docs page: `hedera-docs@836b856:solutions/ai/x402/facilitators.mdx`. Discovery of others: x402scan `https://www.x402scan.com/facilitators`.

### 1.7 Hedera `exact` scheme (`@x402/hedera`)

- Network ids are **`hedera:testnet` / `hedera:mainnet`** (CAIP-2 with named reference). `hedera:296` and
  `eip155:296` are NOT used by the Hedera mechanism; `@x402/evm`'s `DEFAULT_ASSETS` has no `eip155:295/296`
  entry (it does have `eip155:5042002` Arc testnet, `eip155:84532`, `eip155:8453`, ...), so Hedera-EVM via
  the EVM scheme would need a custom money parser and a facilitator that supports it [no such facilitator found].
- `asset`: HTS token id (`"0.0.429274"` testnet USDC, `"0.0.456858"` mainnet USDC — `DEFAULT_ASSETS`, 6 decimals) or
  `"0.0.0"` for HBAR (amount in **tinybars**, 1 HBAR = 10^8). `payTo`: account id `0.0.x` (aliases rejected by
  default policy `aliasPolicy: "reject"`). `extra.feePayer`: facilitator account id. `maxTimeoutSeconds` 180 in examples.
- Payload: `{ "transaction": "<base64 serialized, partially-signed TransferTransaction>" }` whose
  `transactionId.accountId == extra.feePayer`; the client signs, the facilitator co-signs and submits.
  Hedera tx valid duration is 15–180 s (SDK default 120 s), so the payload must be used quickly.
- Settlement response field: the spec example shows `"transactionId": "0.0.1235@1700000000.000000000"`, but the shipped
  facilitator returns `transaction: settled.transactionId` (`@x402/hedera@2.29.0 dist/esm/exact/facilitator/index.mjs:197`),
  i.e. the core `transaction` field holding a Hedera tx id like `0.0.x@sss.nnnnnnnnn`. Parse `transaction` first, fall back to `transactionId`.
- Facilitator MUST checks: plain `TransferTransaction` (no ScheduleCreate), only transfers, net HBAR and net
  token sums zero, feePayer never a net sender, single asset, exact amount to payTo, payer signature valid
  (reason `invalid_exact_hedera_payload_signature_invalid`), replay check.
- Client code (README): `createClientHederaSigner("0.0.1111", PrivateKey.fromStringECDSA(k), { network: "hedera:testnet" })`;
  `new x402Client().register("hedera:*", new ExactHederaScheme(signer))` (import from `@x402/hedera/exact/client`).
  Server: `new x402ResourceServer(facilitatorClient).register("hedera:*", new ExactHederaScheme({ defaultAssets: { "hedera:testnet": { asset: "0.0.429274", decimals: 6 } } }))`
  (import from `@x402/hedera/exact/server`). Both payer and payee must be **associated** with the token
  (`TokenAssociateTransaction`), else `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.
- Mirror node URLs baked into the package: `https://testnet.mirrornode.hedera.com`, `https://mainnet-public.mirrornode.hedera.com`.
Source: `specs/schemes/exact/scheme_exact_hedera.md`; `@x402/hedera@2.29.0` README + `dist/esm/index.d.mts`; `hedera-docs@836b856:solutions/ai/x402/*.mdx`.

### 1.8 Server/client wiring (verified README snippets)

```ts
// server (Hono)
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";      // also exported from "@x402/core/http"
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme())
  .register("hedera:*", new ExactHederaScheme({ defaultAssets: { "hedera:testnet": { asset: "0.0.429274", decimals: 6 } } }));
app.use(paymentMiddleware({ "GET /bundle": { accepts: [
  { scheme: "exact", price: "$0.10", network: "eip155:84532", payTo: "0xYourEvmAddress" },
  { scheme: "exact", price: "$0.10", network: "hedera:testnet", payTo: "0.0.YourAccount" } ], description: "..." } }, resourceServer));
// paymentMiddleware(routes, server, paywallConfig?, paywall?, syncFacilitatorOnStart? = true)

// client
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";                      // client-side class lives at the package root
import { privateKeyToAccount } from "viem/accounts";
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:*", client: new ExactEvmScheme(privateKeyToAccount(PK)) }] });
const res = await fetchWithPayment(url); decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!);
```
`"$0.10"` string prices resolve through `DEFAULT_ASSETS` (first entry per network); Base Sepolia resolves to USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e` with `extra { name: "USDC", version: "2" }`. Client spend controls default to a
$1 cap on recognised stablecoins (`DEFAULT_ASSETS.md`).

---

## 2. Hedera

### 2.1 Networks, RPC, explorers

| Item | Value | Source |
| --- | --- | --- |
| JSON-RPC relay testnet | `https://testnet.hashio.io/api`, chain id **296** (`0x128`); alt `https://296.rpc.thirdweb.com` | `hedera-docs:evm/development/json-rpc/index.mdx:41`, `evm/tutorials/intermediate/json-rpc-connections/index.mdx:43` |
| JSON-RPC relay mainnet / previewnet | `https://mainnet.hashio.io/api` 295 (`0x127`); `https://previewnet.hashio.io/api` 297 | same |
| Mirror node REST testnet | `https://testnet.mirrornode.hedera.com/api/v1` | `hedera-docs:openapi.yaml` servers `{network}.mirrornode.hedera.com`; `@x402/hedera` constant |
| Mirror node REST mainnet | `https://mainnet.mirrornode.hedera.com/api/v1` (docs) / `https://mainnet-public.mirrornode.hedera.com` (`@x402/hedera`) | |
| HashScan | `https://hashscan.io/{testnet|mainnet}/transaction/{txId}`, `/account/{0.0.x}`, `/token/{0.0.x}`, `/contract/{0.0.x|0x..}`, `/address/{0xevm}`; `/topic/{0.0.x}` **[unverified by docs grep; by analogy]** | `hedera-docs:native/**` code (`hashscan.io/${network}/transaction/${txId}`), `evm/**` |
| Faucets | Portal `https://portal.hedera.com/` (testnet HBAR + account/keys); Circle `https://faucet.circle.com/` -> "Hedera Testnet" mints USDC `0.0.429274` to an **already-associated** account (takes `0.0.x`, not EVM addr) | `@x402/hedera` README |
| Testnet resets | periodically, announced 2–4 weeks ahead | `hedera-docs:skill.md` |

### 2.2 USDC on Hedera (HTS)

- Testnet USDC token id **`0.0.429274`**, mainnet **`0.0.456858`**, **6 decimals** (`@x402/hedera` `HEDERA_TESTNET_USDC`,
  `HEDERA_USDC_DECIMALS`; Circle's Hedera page lists the same ids per search).
- EVM "long-zero" address form = `0x` + 40 hex of the entity number: testnet `0x0000000000000000000000000000000000068cDa`
  (429274 = 0x68CDA), mainnet `0x000000000000000000000000000000000006F89A` (computed; the testnet value also appears
  in a third-party Hedera guide — confirm on HashScan token page).
- HTS decimals are set at token creation (default 0); never assume; read `/api/v1/tokens/{tokenId}`.

### 2.3 Decimals quirks (8 vs 18)

| API/Service | Decimals |
| --- | --- |
| HAPI (SDK), Hedera Smart Contract Service, JSON-RPC **arguments** | HBAR has **8** (tinybar) |
| JSON-RPC relay **`msg.value`** and `gasPrice` | **18** (weibar); 1 tinybar = 10^10 weibar; network truncates to tinybar |
| HTS tokens | configurable (USDC 6) |
| ERC-20 contracts on Hedera EVM | whatever the contract says (commonly 18) |
Mirror node `/api/v1/contracts/results*` accept `hbar=false` to return raw weibar values. Fees always in tinybars.
Source: `hedera-docs:evm/differences/hbar-decimals.mdx`, `skill.md:147`, `openapi.yaml:5857`.

### 2.4 Token association

- SDK: `await new TokenAssociateTransaction().setAccountId(AccountId.fromString(id)).setTokenIds([TokenId.fromString("0.0.429274")]).execute(client).then(r => r.getReceipt(client))`
  (`@x402/hedera` README). Alternative: `maxAutomaticTokenAssociations` on the account (`AccountUpdateTransaction`).
- From Solidity: HTS system contract at **`0x167`** (`0x0000000000000000000000000000000000000167`), `IHederaTokenService.associateToken(address account, address token)`;
  under the v2 security model `msg.sender` must be the account being associated; alternative HIP-719 facade `IHRC.associate()` called on the
  token's EVM address. Exchange-rate precompile `0x168`, PRNG `0x169`. Creating tokens via `0x167` needs HBAR in `msg.value`.
  Source: `hedera-docs:evm/development/deploying.mdx:142`, `evm/development/security.mdx:106`, `evm/hedera-services/hts-solidity/create-tokens.mdx`.

### 2.5 SDK and HCS (topics)

- Current JS SDK is **`@hiero-ledger/sdk` 2.90.1** (published 2 Nov 2026). `@hashgraph/sdk` stopped at 2.81.0 (Mar 2026); hedera-docs skill says
  "generate `@hiero-ledger/sdk` imports, not `@hashgraph/sdk`". `@x402/hedera` pins `@hiero-ledger/sdk 2.90.1`; import SDK symbols through
  `@x402/hedera` re-exports to avoid duplicate-SDK `instanceof` failures (`t.startsWith is not a function`).
- Keys: use `PrivateKey.fromStringECDSA()` / `fromStringED25519()`; `PrivateKey.fromString()` and `PrivateKey.generate()` are deprecated.
  ECDSA is required for EVM/JSON-RPC tooling and for the Agent Kit's EVM tools. Portal shows the key type. Mismatch -> `INVALID_SIGNATURE`.
- Client: `Client.forTestnet().setOperator(AccountId.fromString(id), PrivateKey.fromStringECDSA(k))`; tx valid duration 15–180 s (default 120).
- Submit a receipt to a topic (`hedera-docs:native/consensus/submit-message.mdx:156`):
  ```ts
  const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(receipt)) /* .setCustomFeeLimits(max) if topic has HIP-991 fees */ .execute(client);
  const receipt = await tx.getReceipt(client); // receipt.status, receipt.topicSequenceNumber
  ```
  Create topic: `TopicCreateTransaction` (optionally `.setSubmitKey`). Message size is chunked by the SDK (mirror `chunk_info`).
- Read back (mirror REST, `hedera-docs:openapi.yaml:1155`): `GET /api/v1/topics/{topicId}/messages?encoding=base64&limit=25&order=asc|desc&sequencenumber=N&timestamp=gte:...`
  -> `{ "messages": [{ "chunk_info", "consensus_timestamp": "1234567890.000000001", "message": "<base64>", "payer_account_id": "0.0.10", "running_hash": "<base64>", "running_hash_version": 2, "sequence_number": 1, "topic_id": "0.0.7" }], "links": { "next": ... } }`;
  single: `GET /api/v1/topics/{topicId}/messages/{sequenceNumber}`; metadata `GET /api/v1/topics/{topicId}` (HIP-874; includes custom fees per HIP-991).
  Mirror node is free but rate-limited; messages appear a few seconds after consensus.

### 2.6 Hedera Agent Kit (agent buyer)

- Package **`@hashgraph/hedera-agent-kit` 4.2.0** (28 Oct 2026). The old unscoped `hedera-agent-kit` 3.8.2 is **deprecated** ("use @hashgraph/hedera-agent-kit (v4)",
  migration `docs/MIGRATION-v4.md`). Adapters: `@hashgraph/hedera-agent-kit-langchain` 2.1.0, `-ai-sdk` 2.1.0 (Vercel AI SDK), `-mcp` 1.2.0, `-elizaos`, `-adk`; scaffold `create-hedera-agent`.
- Install (README): `npm i @hiero-ledger/sdk @hashgraph/hedera-agent-kit @hashgraph/hedera-agent-kit-langchain langchain @langchain/openai` (or `@langchain/anthropic`).
- Wallet + toolkit (README):
  ```ts
  import { Client, PrivateKey } from '@hiero-ledger/sdk';
  import { AgentMode } from '@hashgraph/hedera-agent-kit';
  import { allCorePlugins /* or coreAccountPlugin, coreTokenPlugin, coreConsensusPlugin, ... */ } from '@hashgraph/hedera-agent-kit/plugins';
  import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
  const client = Client.forTestnet().setOperator(process.env.ACCOUNT_ID!, PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!));
  const toolkit = new HederaLangchainToolkit({ client, configuration: { plugins: allCorePlugins, context: { mode: AgentMode.AUTONOMOUS } } });
  const tools = toolkit.getTools();
  ```
  `AgentMode.RETURN_BYTES` returns unsigned tx bytes for human-in-the-loop signing.
- Framework-agnostic path (`packages/core/src/shared/api.ts` JSDoc): `const discovery = ToolDiscovery.createFromConfiguration(configuration); const allTools = discovery.getAllTools(configuration.context ?? {}, configuration); const api = new HederaAgentAPI(client, configuration.context, allTools); await api.run(tool.method, args);`
- Transfer / receipt tools (`docs/HEDERATOOLS.md`):
  `TRANSFER_HBAR_TOOL { transfers: [{ accountId, amount /* HBAR, display units */ }], sourceAccountId?, transactionMemo? }`;
  `TRANSFER_FUNGIBLE_TOKEN_TOOL { tokenId: "0.0.429274", transfers: [{ accountId, amount /* display units */ }], senderAccountId?, transactionMemo? }`;
  `CREATE_TOPIC_TOOL { topicMemo?, adminKey?: boolean|string, submitKey?: boolean|string }`; `SUBMIT_TOPIC_MESSAGE_TOOL { topicId, message, transactionMemo? }`.
  Hooks/policies (`docs/HOOKS_AND_POLICIES.md`) include an `HcsAuditTrailHook` example and `MaxRecipientsPolicy`.
- The Agent Kit does not itself speak x402; pair it with `@x402/fetch` + `@x402/hedera` client (see `hedera-dev/x402-inference-pay-per-request-poc`).

### 2.7 HCS-14 Universal Agent ID (standards SDK)

- Package `@hashgraphonline/standards-sdk` **0.1.192** (19 Oct 2026); module `src/hcs-14/` exports `createUaid`, `parseHcs14Did`, `canonicalizeAgentData`, `HCS14Client`, resolvers/issuers.
- Self-issued form: `uaid:aid:<id>;uid=0;registry=<registry>;nativeId=<nativeId>[;proto=<p>][;domain=<d>]` where
  `id = base58( sha384( JSON.stringify({ skills:[sorted ints], name, nativeId, protocol(lowercase), registry(lowercase), version }) ) )`
  (key order exactly `skills,name,nativeId,protocol,registry,version`; strings trimmed). For `protocol: "hcs-10"` `nativeId` MUST be CAIP-10 `hedera:<network>:<0.0.x>`;
  for `acp-virtuals` it must be `eip155:<chainId>:<0x..>`.
- Wrapped-DID form: `uaid:did:<method-specific-id>[;uid=..;registry=..;proto=..;nativeId=..;domain=..;src=z<base58btc(original DID)>]`; for `did:hedera:` the `mainnet|testnet|previewnet|devnet:` prefix is stripped; `src` is added when the DID had `;?#` suffixes.
- Params: `uid`, `registry`, `proto`, `nativeId`, `domain`, `src`. `parseHcs14Did()` returns `{ method: 'aid'|'uaid', id, params }`.
Source: `standards-sdk@04f97c8:src/hcs-14/did.ts`, `canonical.ts`, `types.ts`.

---

## 3. Arkiv

### 3.1 SDK

- **`@arkiv-network/sdk` 1.0.1** (published 2 Nov 2026; repo `Arkiv-Network/arkiv-sdk-js`), peer dep `viem ^2`, Node >= 22.10. Older `golem-base-sdk` 0.1.16 is **deprecated** on npm.
  Python: `arkiv-sdk` 0.2.2 on PyPI [contents unverified]. Entry points: `@arkiv-network/sdk` (`createPublicClient`, `createWalletClient`, `ExpirationTime`),
  `@arkiv-network/sdk/chains` (`rabdi`, `localhost`), `@arkiv-network/sdk/schema` (`defineSchema`, `bool,i32,u64,u256,dec,str,addr,key,bytes`), `@arkiv-network/sdk/query` (`eq,gt,lt,between,and,or,asc,desc` ...).
- Access key (not secret) is appended as the last RPC path segment: `rabdi({ accessKey })`; get one at `https://hub.arkiv.network/access-keys`.
  Anonymous public endpoint is heavily rate limited (HTTP 429 with `RateLimit` + `Retry-After`, `Link: <hub>; rel="help"`); billed responses carry `Arkiv-Cost` and `Arkiv-Quota-Remaining`.

### 3.2 Networks (as of 3 Nov 2026)

| Network | Chain id | RPC | Notes |
| --- | --- | --- | --- |
| **rabdi** (the chain the SDK 1.0.1 ships and its README calls "the Arkiv testnet") | **7794095** | `https://rpc.rabdi.db-chain.testnet.arkiv.network[/<accessKey>]`, `wss://` same host | explorer `https://rabdi.explorer.arkiv.network`; gas token `tGLM` ("Golem"); registry: "Public testnet on the GolemDB node; indexer, metered RPC edge and faucet" |
| tiramisu | 7738577 | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` (+wss) | registry: "Public Arkiv testnet ... the network external developers join"; snapshots `https://testnet.snapshots.arkiv.network/tiramisu/latest.json`; not exported by SDK 1.0.1 (`defineChain` it yourself) |
| sorbet | 7706815 | `https://rpc.sorbet.db-chain.testnet.arkiv.network` | Sourcify-prefilled load-test net |
| Kaolin | — | — | **retired**: search snippet (template repo) says it stopped responding 15 May 2026, migration notes at `docs.arkiv.network/networks/migrate-from-kaolin/` **[unverified; docs host blocked]**. Do not target it. |
| Braga | 60138453102 (third-party repo) | `https://braga.hoodi.arkiv.network/rpc` | **[unverified, probably superseded]** |
Faucet: `https://hub.arkiv.network/faucet` (tGLM). Fee/gas token: **tGLM** (testnet GLM); block time 2 s; per-tx gas cap 2^24 (EIP-7825).
Source: `@arkiv-network/sdk@1.0.1 src/chains/rabdi.ts`, `src/consts.ts`, README; `db-chain-networks@8af442e9 README.md`, `networks/testnet/tiramisu/README.md`.
Hackathon note: which testnet Arkiv judges want (rabdi vs tiramisu) is a known unknown; the SDK default is rabdi.

### 3.3 Entity API (SDK 1.0.1)

```ts
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, eq, gt, asc, desc } from "@arkiv-network/sdk/query"
import { addr, bytes, dec, defineSchema, str, u64, bool } from "@arkiv-network/sdk/schema"
const Entitlements = defineSchema("entitlements", {           // name tags entities with indexed `arkiv.schema`
  nullifier: str().indexed(), iccid: str().indexed(), bundleMb: u64().indexed(), payer: addr().indexed(),
  receiptTx: str(), lpaCiphertext: bytes(),                   // bytes: never indexed, up to 128 KiB
  status: str().default("active"), note: str().optional(),
})
const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" })
const publicClient = createPublicClient({ chain, transport: http() })
const walletClient = createWalletClient({ chain, transport: http(), account })
const { entityKey, txHash } = await walletClient.createEntity(Entitlements, { ...values },
  { expiration: ExpirationTime.fromDays(7), flags?: { readonly?: false, permissionlessExtension?: false } })
await walletClient.patchEntity(Entitlements, entityKey, { set: { status: "used" } })
await walletClient.extendEntity({ entityKey, expiration: ExpirationTime.fromDays(30) })
await walletClient.deleteEntity({ entityKey })
const row = await publicClient.getEntity(entityKey, Entitlements)
const page = await publicClient.select({ $key: true, $expiresAt: true, iccid: true })
  .from(Entitlements).where(and(eq("nullifier", n), gt("bundleMb", 0n))).ownedBy(account.address)
  .orderBy(asc("$key")).limit(100).offset(0).fetch()   // -> { entities, skipped }
```
- Expiry: `ExpirationTime.fromSeconds|fromMinutes|fromHours|fromDays|fromWeeks(n)` (must be a whole number of 2-s blocks), or absolute
  `ExpirationTime.atBlock(n, { atLeast })` / `atDate(date, { atLeast })`. Max lifetime **7,884,000 blocks (~182.5 days)**; chain reverts `ExpiryBeyondMaxLifetime`.
  The old `expiresIn`/BTL naming is gone; the option is `expiration` and the system field is `$expiresAt` (block number). Entities expire and disappear from queries.
- Query syntax: `where()` takes indexed columns and system fields `$key`, `$owner`, `$creator`, `$expiresAt` (`eq, gt, lt, between, and, or`); select fields
  `$key,$owner,$creator,$createdAt,$updatedAt,$expiresAt,$creationFlags`, attributes, `$attributes` (map), `$attributeSchema`; `orderBy` single key (`asc|desc`, no `bytes`, no `$createdAt`);
  pages <= 100 rows; paginate by `gt("$key", key(lastKey))`. Without a schema: omit `.from()`; values come back as `{ type, value }`.
- Other actions: `changeOwnership`, `executeBatch`, `watchEntityEvents`, `predictEntityKeys`, `getEntityNonce`, `getBlockTiming`. Arkiv system contract `0x4400000000000000000000000000000000000044`.
- Debug: `DEBUG=arkiv:*`.
Source: `@arkiv-network/sdk@1.0.1` README, `src/actions/wallet/*.ts`, `src/utils/expirationTime.ts`, `src/consts.ts`.

### 3.4 Arkiv + Swarm bonus pointers

- Prize text (team notes `research/sponsors.md:73-74`, from the hacklist): bonus $500 x 2 (from-scratch and existing); repo must contain a file explaining what each
  platform stores, an Arkiv entity key, and the Swarm reference it points to. One Arkiv track prize per team + bonus; counts as one partner pick. Web search found no
  independent page for this bonus **[unverified beyond team notes]**.
- Swarm facts (Bee OpenAPI `ethersphere/bee@ed32cfa:openapi/Swarm.yaml`): upload `POST /bzz` (single file, or `swarm-collection` tar/multipart) with headers
  `swarm-postage-batch-id` (required unless deferred/paid otherwise), `swarm-pin`, `swarm-index-document`, `swarm-deferred-upload`; returns a `SwarmReference`
  = 64-hex address, or 128-hex encrypted reference, or an ENS domain. JS client `@ethersphere/bee-js` **13.2.0** (27 Oct 2026). A hosted gateway/testnet batch
  for the hackathon is **[unverified]**. Store the Swarm reference as an indexed `str` attribute on the Arkiv entity and write the explaining file.

---

## 4. World ID

### 4.1 Packages (npm, 3 Nov 2026)

| Package | Version | Status |
| --- | --- | --- |
| `@worldcoin/idkit` | **4.6.0** | React widget `IDKitRequestWidget` (controlled: `open`/`onOpenChange`), `IDKitSessionWidget`, presets; also `@worldcoin/idkit/signing` |
| `@worldcoin/idkit-core` | **4.6.0** | vanilla JS: `IDKit.request(config).preset(...)`, subpaths `/signing`, `/hashing`, `/session`, `/nullifier`, `/expo` |
| `@worldcoin/idkit-server` | (dep of idkit-core) | `signRequest`, `getSessionCommitment`, `Nullifier` |
| `@worldcoin/idkit-standalone` | 2.2.5 | **deprecated / discontinued** — migrate to idkit-core (`world-id/from-idkit-standalone.mdx`) |
| `idkit-standalone` (unscoped), `@worldcoin/idkit-react` | — | not on npm |
| `@worldcoin/minikit-js` | 2.0.3 | World App mini apps (not needed for IDKit web) |
| `@worldcoin/agentkit` / `agentkit-core` / `agentkit-cli` | 0.2.1 / 0.2.1 / 0.2.0 | AgentKit beta (4.5) |
Do **not** pin `^2.x`/`^3.x` (docs: "will not work with v4"). The GitHub repo `worldcoin/idkit-js` is the legacy v2 line (2.4.2); v4 source is `github.com/worldcoin/idkit`.

### 4.2 Request (client) — v4 requires a backend-signed `rp_context`

```ts
import { IDKit, proofOfHuman, orbLegacy, deviceLegacy } from "@worldcoin/idkit-core";
const request = await IDKit.request({
  app_id: "app_xxxxx", action: "recharge-claim",
  rp_context: { rp_id: "rp_xxxxx", nonce: "0x..", created_at: 1735689600, expires_at: 1735689900, signature: "0x.." }, // from backend
  allow_legacy_proofs: true,          // required prop; true for proofOfHuman/orbLegacy fallback presets
  environment: "production",          // "staging" only with the simulator https://simulator.worldcoin.org
}).preset(proofOfHuman({ signal: "<wallet or user id>" }));
request.connectorURI;                 // render as QR (empty inside World App: native transport)
const completion = await request.pollUntilCompletion({ pollInterval: 2_000, timeout: 120_000 }); // { success, result | error }
```
Presets: `proofOfHuman` (Orb, with legacy Orb fallback), `passport`, `selfieCheck`, `identityCheck`, `mnc`; legacy `orbLegacy`, `secureDocumentLegacy`, `documentLegacy`, `deviceLegacy`, `selfieCheckLegacy`.
Legacy presets return the highest credential the user holds. Sessions (`IDKit.createSession` / `proveSession`, `IDKitSessionWidget`) for returning users.
Backend signing (`@worldcoin/idkit-core/signing`): `signRequest({ signingKeyHex: RP_SIGNING_KEY, action, ttl: 300 })` -> `{ sig, nonce, createdAt, expiresAt }`.
Algorithm (`world-id/idkit/signatures.mdx`): msg = `0x01 || nonce(32) || created_at u64 BE || expires_at u64 BE || hash_to_field(action)` (49 or 81 bytes),
EIP-191 personal-sign with keccak256, `hash_to_field(x) = keccak256(x) >> 8`. Test vectors: `hash_to_field("")=0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4`,
`"test_signal"->0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed`, `"hello"->0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea`.
Never ship `RP_SIGNING_KEY` to the client; Portal returns it once (`configure_world_id`); rotation invalidates the old signer.

### 4.3 Proof result shapes (`@worldcoin/idkit-core@4.6.0 dist/index.d.ts`)

`IDKitResult = IDKitResultV3 | IDKitResultV4 | IDKitResultSession` (forward as-is to the verifier).
- V4 uniqueness: `{ protocol_version: "4.0", nonce, action, environment?, responses: [{ identifier: "proof_of_human" | "passport" | "mnc" | "selfie", issuer_schema_id: 1 (proof_of_human) | 9303 (passport) | 9310 (mnc) | 11 (selfie), nullifier: "<decimal>", expires_at_min, proof: ["0x..", x5], signal_hash, sybil_score? }] }`.
- V3 legacy: `{ protocol_version: "3.0", nonce, action, responses: [{ identifier: "orb" | "secure_document" | "document" | "device" | "selfie", merkle_root, nullifier, proof, signal_hash, max_age }] }` (field list from `ResponseItemV3`; the `identifier` value set is inferred from the OpenAPI `uniqueness_v3` example (`"orb"`) plus the legacy `verification_level` enum — [partly unverified]).
- Session: `{ protocol_version: "4.0", nonce, session_id, responses: [{ identifier, issuer_schema_id, session_nullifier: [string, string], expires_at_min, proof }] }`.
- The classic `ISuccessResult { proof, merkle_root, nullifier_hash, verification_level: "orb"|"secure_document"|"document"|"device" }` is the **v2 IDKit** shape
  (`idkit-js@bd8ea11:packages/core/src/types/result.ts`, `config.ts`) and only pairs with the legacy v2 endpoint.
Error codes (v4): `user_rejected, verification_rejected, credential_unavailable, feature_unavailable, world_id_4_not_available, world_id_3_not_available, malformed_request, invalid_network, inclusion_proof_pending, inclusion_proof_failed, unexpected_response, connection_failed, max_verifications_reached, failed_by_host_app, user_presence_failed, invalid_rp_signature, nullifier_replayed, duplicate_nonce, unknown_rp, inactive_rp, timestamp_too_old, timestamp_too_far_in_future, invalid_timestamp, rp_signature_expired, identity_attributes_not_matched, generic_error`.

### 4.4 Developer Portal cloud verify

OpenAPI (`developer-docs@b07e972:openapi/developer-portal.json`) servers: `https://developer.world.org` (primary), `https://developer.worldcoin.org` (legacy), `https://staging-developer.worldcoin.org`.
- **Current:** `POST /api/v4/verify/{rp_id}` (`rp_...` recommended; `app_...` accepted). Body = the IDKit result **unchanged** (`{...idkitResponse, environment: "production"}` in the docs sample).
  200 -> `{ "success": true, "action", "nullifier", "created_at", "environment": "production"|"staging"|"sandbox", "session_id"?, "results": [...], "message"? }`.
  400 -> `{ "success": false, "code": "app_not_migrated" | "all_verifications_failed" | ..., "detail", "results"?: [{ identifier, success:false, code:"verification_error", detail }] }`; 404 app not found.
  Backend must assert `environment` matches and then store `(action, nullifier)` with a UNIQUE constraint (`NUMERIC(78,0)`); reject duplicates (`nullifier_replayed`).
- **Legacy:** `POST /api/v2/verify/{app_id}` body `{ nullifier_hash, merkle_root, proof, verification_level: "orb"|"secure_document"|"document"|"device"|"face"|"selfie", action, signal_hash?, max_age? (3600..604800, default 7200) }`
  -> 200 `{ "success": true, "action", "nullifier_hash", "created_at" }`; 400 codes `invalid_proof`, `invalid_merkle_root`, `root_too_old`, `invalid` (attribute `credential_type`), `exceeded_max_verifications`, `already_verified`.
  `signal_hash` defaults to hash of empty string (`0x00c5d246...85a4`). idkit-js v2 posted to `https://developer.worldcoin.org/api/v2/verify/${app_id}` (`packages/core/src/lib/backend.ts:24`).
- Other Portal endpoints: `POST /api/v2/create-action/{app_id}`, `POST /api/v1/precheck/{app_id}`, `GET /api/v1/jwks`. Developer Portal MCP: `https://developer.world.org/api/mcp` (streamable-http, `Authorization: Bearer api_<base64(id:secret)>`), tools `configure_world_id`, `create_world_id_action`, `get_world_id_registration_status`, `rotate_world_id_signing_key`.

### 4.5 Action / signal rules

- Actions are created per app **and per environment** (`production` | `staging` | `sandbox`); the IDKit `environment`, the action's environment and simulator-vs-real-phone must all match (staging + real World App = silent zero proofs).
  App `app_mode` must be `external` for IDKit (`mini-app` for MiniKit) and is fixed at creation. On-chain RP registration must reach `registered` before production.
- Uniqueness proofs are one-time per (action, user); use separate actions for separate one-time operations and sessions for recurring checks. `signal` is optional context (user id, wallet) the backend must enforce identically.
- Only one NFC credential (passport/MNC/eID) per Authenticator; never `all(passport(), mnc())`.
Source: `developer-docs@b07e972:world-id/SKILL.md`, `world-id/idkit/integrate.mdx`, `world-id/idkit/credentials.mdx`, `world-id/4-0-migration.mdx`.

### 4.6 AgentKit status

- Public **beta** since 17 Mar 2026 (World blog/TechCrunch); docs public at `docs.world.org/agents/agent-kit` (`developer-docs:agents/agent-kit/{integrate,sdk-reference,ecosystem}.mdx`) plus `agents/human-in-the-loop`. The term **"Agent Pass" does not appear in World's docs** — the official names are AgentKit and Human-in-the-loop [whether the ETHGlobal prize page says "Agent Pass": unverified].
- It is an **x402 extension named `agentkit`**: server declares `extensions: declareAgentkitExtension({ statement, mode })`, registers `agentkitResourceServerExtension` on `x402ResourceServer`, and `createAgentkitHooks({ agentBook: createAgentBookVerifier(), storage: new InMemoryAgentKitStorage(), mode: { type: "free" | "free-trial", uses } | { type: "discount", percent, uses } })` -> `.onProtectedRequest(hooks.requestHook)` on `x402HTTPResourceServer`. Agent side: `createAgentkitClient({ signer: { address, chainId: "eip155:8453", type: "eip191"|"eip1271", signMessage } }).fetch(url)` retries a 402 once with a signed `agentkit` header, else falls back to normal x402 payment.
- Agent wallet registration: `npx @worldcoin/agentkit-cli register <agent-address>` (World App verification, AgentBook on **World Chain `eip155:480`**, hosted relay); `status <addr>`. Usage counters are per human per endpoint.
- World Chain USDC `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1` (EIP-712 name "USD Coin", version "2"); facilitator `https://x402-worldchain.vercel.app/facilitator`. `@worldcoin/agentkit@0.2.1` depends on `@x402/core ^2.4.0`.

---

## 5. eSIM resellers

### 5.1 eSIM Access (primary) — `esimaccess/esimaccess-api@b9421b3:references/api-reference.md`

- Base URL **`https://api.esimaccess.com/api/v1/open`**; every endpoint is `POST` with JSON body. Credentials: `accessCode` from `https://console.esimaccess.com/developer/index`. Self-serve console; no separate sandbox host is documented (orders cost real balance; `/esim/cancel` refunds unused profiles).
- Auth headers: `Content-Type: application/json`, `RT-AccessCode: <accessCode>`, `RT-Timestamp: <ms epoch>`, `RT-RequestID: <uuid>`, `RT-Signature: lowercase hex HMAC-SHA256(key = accessCode, message = timestamp + requestId + accessCode + rawBody)`. (The public docs also show a bare `RT-AccessCode` example [search snippet]; the official skill uses the signed form — implement the signed form.) Rate limit 8 req/s (docs v1.5 note, search snippet); error `101003` = signature mismatch (docs snippet).
- Units: prices are USD x 10,000 (`18000` = $1.80); volumes in bytes (`1073741824` = 1 GB).
- Endpoints and bodies:
  | Endpoint | Body | Returns |
  | --- | --- | --- |
  | `/balance/query` | `{}` | `obj.balance` (x10,000) |
  | `/package/list` | `{ locationCode:"IN", type:"", slug:"", packageCode:"", iccid:"" }` (all optional; `iccid` -> compatible top-ups) | `obj.packageList[]: { packageCode, slug, name, price, retailPrice, currencyCode, volume, duration, durationUnit:"DAY", location, speed, supportTopUpType (2 = top-up ok), activeType, locationNetworkList }` |
  | `/esim/order` | `{ transactionId:"<unique>", packageInfoList:[{ packageCode, count:1, periodNum? /* daily plans only */ }] }` | `obj: { orderNo, transactionId }`; then poll `/esim/query` every 3 s (ICCID typically in 3–10 s) |
  | `/esim/query` | `{ orderNo:"", iccid:"", pager:{ pageNum:1, pageSize:20 } }` (one of orderNo/iccid) | `obj.esimList[]: { esimTranNo, orderNo, transactionId, imsi, iccid, msisdn, ac, qrCodeUrl ("https://p.qrsim.net/xxx.png"), shortUrl, smdpStatus: RELEASED|ENABLED|DISABLED|DELETED, esimStatus: GOT_RESOURCE|IN_USE|USED_UP, eid, activeType, dataType, activateTime, expiredTime (ISO), totalVolume, totalDuration, durationUnit, orderUsage (bytes), smsStatus, packageList[] }`, `obj.pager` |
  | `/esim/topup` | `{ esimTranNo, iccid:"", packageCode, transactionId }` | success only; no webhook for top-ups |
  | `/esim/usage/query` | `{ esimTranNoList:[...] }` | usage (needs esimTranNo, not ICCID) |
  | `/esim/cancel` (unused, refund) / `/esim/revoke` (activated, no refund) / `/esim/suspend` / `/esim/unsuspend` | `{ esimTranNo }` | |
  | `/esim/sendSms` | `{ iccid, message }` | |
  | `/webhook/save` / `/webhook/query` | `{ webhookUrl }` / `{}` | `obj.webhook` |
- `ac` = activation code (the LPA string for the profile) and `qrCodeUrl` = PNG of it; in the reference example `ac` is `""` while `smdpStatus` is `RELEASED` right after order — **[unverified]** when it is populated; test with a real order.
- Status model: New = `RELEASED`/`GOT_RESOURCE`/eid empty; installed = `ENABLED`/eid present; in use = `IN_USE`, `orderUsage > 0`; depleted `USED_UP`; deleted `DELETED`.
- Webhooks: types `ORDER_STATUS` (payload has no ICCID — query the API), `ESIM_STATUS` (smdpStatus + esimStatus), `SMDP_EVENT` (DOWNLOAD, INSTALLATION, ENABLED), `DATA_USAGE` (1–3 h delay), `VALIDITY_USAGE` (1 day before expiry), `CHECK_HEALTH` (one-time on setup). Sender IPs to whitelist: `3.1.131.226, 54.254.74.88, 18.136.190.97, 18.136.60.197, 18.136.19.137`. **Exact webhook JSON schema and any signature header are not in the skill reference [unverified]** — treat as untrusted and re-query `/esim/query`.
- Error codes: `200002` status does not allow action, `200007` insufficient balance, `310402` duplicate transactionId, `400001` invalid params, `401001` auth failed, `000105` validation error.
- Reference clients: official test script `scripts/test-esim-api.mjs` (15 e2e tests); community `corbinlii/esimaccess-python`, Hex `esim_access`.

### 5.2 MegaeSIM — **no public API documentation found** (two searches, Nov 2026). Treat the "instant sandbox" claim in `research/committee/round3-rescore.md` as **[unverified]**; obtain docs from the vendor on-site.

### 5.3 Airalo Partner API (fallback) — docs `https://developers.partners.airalo.com/` (apidog). Search-verified: `POST /v2/token` with `client_id`/`client_secret` (client-credentials, token valid 24 h);
sandbox and production **share the same base URL and credentials**; sandbox orders are simulated (no real eSIM/charges/usage); switching the account to production is one-way; catalog identical in both.
Base URL, `/v2/packages`, `/v2/orders`, `/v2/sims/{iccid}` paths **[unverified]**. Onboarding historically takes weeks (team notes).

### 5.4 Activation strings and install links

- LPA activation code format (GSMA SGP.22): `LPA:1$<SM-DP+ FQDN>$<matching-id>[$<oid>[$<confirmation-code-required flag>]]` — standard format; confirm the reseller's `ac` field is this full string **[unverified against a live profile]**.
- Apple universal link (iOS **17.4+**): `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$<smdp>$<matching-id>` opens the native eSIM install sheet directly; host must be lowercase; must open as an external link (not an in-app webview); on non-iOS devices nothing happens. Verified via eSIM-Go help article and eSIM Access blog post titles/snippets (vendor pages, not Apple docs).
- Android: no Apple-equivalent universal link from Google; a Flutter package cites `https://esimsetup.android.com/...` and gates on `EuiccManager` (API 29+) **[unverified]**. Plan for: show QR + "copy activation code" + manual SM-DP+/matching-id entry; Android users install via Settings > Network > Add eSIM.

---

## 6. ENS (viem 2.57.15)

```ts
import { createPublicClient, http } from "viem"; import { mainnet } from "viem/chains";
import { getEnsAddress, getEnsText, normalize, namehash } from "viem/ens";
const client = createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC) });
const addr = await getEnsAddress(client, { name: normalize("vitalik.eth") /*, coinType?, universalResolverAddress?, gatewayUrls?, strict?, blockNumber?*/ }); // Address | null
const avatar = await getEnsText(client, { name: normalize("vitalik.eth"), key: "avatar" });
namehash("vitalik.eth"); // 0x...
```
- `getEnsAddress` encodes `addr(bytes32)` (or `addr(bytes32,uint256 coinType)`) and calls the **Universal Resolver** `resolveWithGateways(dnsEncodedName, data, gateways)` (CCIP-Read, default local batch gateway), so offchain/L2 names resolve too. `normalize` is ENSIP-15 (via `ox/Ens`); always normalize user input.
- **Mainnet read required** for real `.eth` names: the client chain must define `contracts.ensUniversalResolver` — viem `mainnet`: `0xeeeeeeee14d718c2b47d9923deab1335e144eeee` (block 23,085,558); viem `sepolia`: same address (block 8,928,790). `ens-contracts@ebe0b84 deployments/` lists older UniversalResolver deployments (mainnet `0xED73a03F19e8D849E44a39252d222c6ad5217E1e`, sepolia `0x3c85752a5d47DD09D677C645Ff2A938B38fbFEbA`) — prefer viem's newer address or pass `universalResolverAddress` explicitly.
- Sepolia has a full ENS deployment for test names: `ENSRegistry 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` (same as mainnet), `PublicResolver 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`, `ETHRegistrarController 0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968`, `NameWrapper 0x0635513f179D50A207757E05759CbD106d7dFcE8`, `ReverseRegistrar 0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6` (`deployments/sepolia/*.json`). Base Sepolia has only `L2ReverseRegistrar`. Hedera/Arkiv have no ENS; resolve on mainnet (or Sepolia for demos) and pay on the payment chain.
- No public Sepolia RPC is reachable from this sandbox; the resolver adapter must take `ENS_RPC_URL` and have a fixture mode.

---

## 7. Circle USDC and EIP-3009

- EIP-712 domain for FiatTokenV2_2: `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)` with `version = "2"` and `name` = the token's stored `name()` (`FiatTokenV2_2._domainSeparator()` -> `EIP712.makeDomainSeparator(name, "2", _chainId())`, `stablecoin-evm@fc85788:contracts/v2/FiatTokenV2_2.sol:82`).
  **`name` differs per deployment**: `"USD Coin"` on Ethereum (`0xA0b8...eB48`), Base mainnet (`0x8335...2913`), Polygon, Arbitrum, Avalanche, World Chain; **`"USDC"` on Base Sepolia** (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, chainId 84532), Monad, Arbitrum Sepolia is `"USD Coin"` (`x402:typescript/packages/mechanisms/evm/src/defaultAssets.ts`; also Circle Gateway quickstart snippet for Base Sepolia). Read `name()` on-chain before signing.
- Type strings / typehashes (`contracts/v2/EIP3009.sol:33-43`):
  `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)` = `0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267`;
  `ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)` = `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8`;
  `CancelAuthorization(address authorizer,bytes32 nonce)` = `0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429`.
- Functions: V2 `transferWithAuthorization(from,to,value,validAfter,validBefore,nonce,uint8 v,bytes32 r,bytes32 s)`; V2_2 adds `(..., bytes signature)` (packed `r||s||v`, also EIP-1271 for contract wallets) — same for `receiveWithAuthorization` (requires `to == msg.sender`). `whenNotPaused`, `notBlacklisted(from/to)`. Nonce is any unused 32-byte value (random), `validAfter <= block.timestamp < validBefore`.
- Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals; faucet `https://faucet.circle.com/`.
- Test vectors: no official EIP-3009 signature vectors found in the checked sources. The x402 spec's example payload (`from 0x857b06519E91e3A54538791bDbb0E22373e36b66`, `value 10000`, nonce `0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480`, signature `0x2d6a7588...571c`) has no published private key, so it only checks encoding. Generate fixtures locally with viem `signTypedData` + `verifyTypedData` against a known Anvil key and also exercise `recoverTypedDataAddress`; `circlefin/stablecoin-evm` `test/v2/GasAbstraction/*` contains the reference tests [contents not inspected].

---

## 8. Reference projects (link only; treat as untrusted code)

- `https://github.com/dhernz/Glassbox402` — "x402 in one command, with a screen. Watch machines pay. ETHGlobal Lisbon 2026" (1 star; search did not confirm a prize).
- `https://github.com/hedera-dev/x402-inference-pay-per-request-poc` — Hedera Agent Kit + x402 + USDC on Hedera testnet (official hedera-dev).
- `https://github.com/hedera-dev/tutorial-a2a-x402-trustless-agent` — A2A + x402 tutorial (official).
- `https://github.com/matevszm/x402-hedera-example`, `https://github.com/BelgacemElbar/amnt-x402-facilitator` (run-your-own Hedera/EVM facilitator on `@x402/*`).
- `https://github.com/ddpateltp/agora402` — ETHOnline 2026: agents pay per request over x402 settled via Blocky402, receipts on HCS (closest to our shape).
- `https://github.com/livevnx8/hedera-x402-paid-lookup` — ETHOnline 2026 minimal Hedera exact x402 via hosted Blocky402.
- `https://github.com/mandate-run/mandate` — agent buyer runtime proving payments from the Hedera ledger.
- `https://github.com/Manvith-Shetty/Leash` — agents pay over x402 on Hedera with ENS-encoded spend limits.
- `https://github.com/hgunduzoglu/A2A` — ETHGlobal Cannes 2026: World App mini app + ENS identities + x402 USDC + Hedera reputation.
- `https://github.com/web3xDev/onchainrouter`, `https://github.com/edycutjong/retainer` (Hedera Schedule Service renewals over x402), `https://github.com/jmgomezl/aivy-parametric-pool` (Blocky402-paid oracle).
- Hedera's own x402 bounty winners (five, Aug 2026): `https://hedera.com/blog/x402-bounty-on-hedera-winners-announced` (names not retrievable from this sandbox).
- Official examples: `x402@0e6e8c5:examples/` (clients/servers per framework), `hedera-agent-kit@f3d27ae:examples/`, `developer-docs:world-id/idkit/integrate.mdx` sample routes.

---

## Known unknowns to verify on-site Wed 4 Nov

1. `curl https://x402.org/facilitator/supported` — confirm `hedera:testnet` (fee payer `0.0.9185802`) and `eip155:84532` are listed and the exact `extra` shape; same for `https://api.testnet.blocky402.com/supported` and `https://testnet.facilitator.launa.dev/supported`. Pick the primary + fallback facilitator.
2. Which Arkiv testnet the sponsor judges on (SDK 1.0.1 defaults to **rabdi 7794095**; the registry calls **tiramisu 7738577** the developer network; Kaolin appears retired). Get an access key at `hub.arkiv.network/access-keys` and tGLM from `hub.arkiv.network/faucet`; confirm the explorer URL for the chosen chain and whether the Swarm bonus needs a specific Bee gateway/postage batch.
3. World ID: create the app (`app_mode: external`), RP (`rp_id` + one-time signing key into the server secret store) and a **production** action; confirm `allow_legacy_proofs` policy (Orb-only vs device fallback) with the World team; confirm whether "Agent Pass" in the prize text means AgentKit (beta) and whether judges accept AgentKit registration on World Chain mainnet only (CLI registers on World Chain; no testnet AgentBook mentioned).
4. Hedera: fund testnet account via portal, associate `0.0.429274`, mint USDC from `faucet.circle.com`; confirm the facilitator accepts HTS USDC (not just HBAR) and the `transaction` vs `transactionId` field in `PAYMENT-RESPONSE` from the chosen facilitator; confirm HashScan topic URL pattern `hashscan.io/testnet/topic/{0.0.x}`.
5. eSIM Access: open the console account, confirm the signed-header auth works (vs bare `RT-AccessCode`), list India-usable packages (`locationCode: "IN"`), place one real order, capture the real `ac`/LPA string, `qrCodeUrl`, and a full webhook payload (schema + any signature header); measure activation latency on Jio/Airtel; confirm `/esim/cancel` refund.
6. MegaeSIM: obtain any API docs/sandbox credentials from the vendor; otherwise drop it from the plan.
7. Airalo: confirm partner base URL and `/v2/*` paths from `developers.partners.airalo.com` if the fallback is still wanted.
8. Circle: `cast call <usdc> "name()"` on Base Sepolia to confirm `"USDC"` (and `"USD Coin"` on Base mainnet) before signing; confirm facilitator settles `transferWithAuthorization` (EIP-3009) rather than Permit2 for Base Sepolia USDC.
9. ENS: confirm a reachable mainnet RPC (and Sepolia for demo names), and whether judges want ENS text records (e.g. `com.twitter`, `avatar`) or only forward resolution for gifting.
10. Apple link: test `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=...` on a team iPhone (iOS 17.4+) and the Android manual path; record which fields of the reseller response feed the link.
11. Hedera Agent Kit: confirm `@hashgraph/hedera-agent-kit@4.2.0` tool outputs (`transactionId`, `topicSequenceNumber`) in `AUTONOMOUS` mode and that `@hiero-ledger/sdk@2.90.1` resolves to a single copy alongside `@x402/hedera` (run `pnpm why @hiero-ledger/sdk`).

- **[added 3 Nov, contracts workstream]** `DataDrop.sol` uses OpenZeppelin `ReentrancyGuardTransient` (TSTORE/TLOAD, Cancun). Hedera's EVM must support transient storage for the Hedera testnet deploy; if the relay rejects it, swap the import to the storage `ReentrancyGuard` (same revert error; `claim` costs ~5k more gas). Verify at the Wed 14:00 pre-deploy.
- **[added 3 Nov]** EIP-3009 `validAfter` is strict (`validAfter < block.timestamp`) in Circle's FiatTokenV2_2 and in `MockUSDC3009`; API-FACTS §7's `<=` wording is the loose one — code to strict.
