# ENSv2 spike: one ENS name per sponsor campaign (Sepolia)

**Verdict: GO on Sepolia.** `spike.re-charge.eth` is live on ENSv2 Sepolia. It is non-transferable,
it expires after 2 days, and its records live in its own PermissionedResolver. The sponsor can set
`avatar` and nothing else. Stock viem `getEnsText` resolves it with no custom read path.
**Mainnet caveat:** the ENSv2 contracts are deployed on mainnet but are not live yet. The ENS docs
say mainnet registrations and resolution "continue through the ENSv1 contracts" until the v2 launch.

Run on 2026-11-06 with signer `0x69D0714a712B556bb950a7b4Bc3070c16b0dfc88`. Scripts are in
`scripts/ens/`: `spike.sh` sends the transactions, `check.sh` holds the eth_call proofs and
`read.mjs` is the client read.

## Addresses

ENSv2 Sepolia is the set deployed on 2026-10-01: ensdomains/contracts-v2 @`07e55a0`, `contracts/deployments/sepolia`.
This set matches docs.ens.domains/learn/deployments. **Do not use** the `deployments/sepolia` folder on
the repo's `main` branch. It still holds the older 2026-06-29 set, with different addresses everywhere.
The live set is confirmed on-chain: UR `0xeeee…eeee` → ManagedUniversalResolverProxy →
UniversalResolverV2 `0x24e1…`, whose `ROOT_REGISTRY()` is `0xb458…`.

| Contract                                                  | Address                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| RootRegistry                                              | [`0xb458d6a3a77919449d03e7a6903c26827c1ec43f`](https://sepolia.etherscan.io/address/0xb458d6a3a77919449d03e7a6903c26827c1ec43f) |
| ETHRegistry (.eth PermissionedRegistry)                   | [`0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4`](https://sepolia.etherscan.io/address/0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4) |
| ETHRegistrar                                              | [`0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3`](https://sepolia.etherscan.io/address/0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3) |
| VerifiableFactory                                         | [`0xda70306c98e97ece36f997a21368e53298572991`](https://sepolia.etherscan.io/address/0xda70306c98e97ece36f997a21368e53298572991) |
| PermissionedResolver impl                                 | [`0x115eb53f0c60696633855f90b138178fb40b2b2c`](https://sepolia.etherscan.io/address/0x115eb53f0c60696633855f90b138178fb40b2b2c) |
| UserRegistry impl                                         | [`0x9bd8a88719068d09ecee662f36c0e3856708366a`](https://sepolia.etherscan.io/address/0x9bd8a88719068d09ecee662f36c0e3856708366a) |
| Universal Resolver (viem default; proxies to v2)          | [`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`](https://sepolia.etherscan.io/address/0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe) |
| UniversalResolverV2 (current impl)                        | [`0x24e1d8e068620b647ca097f961a61055f4f42d72`](https://sepolia.etherscan.io/address/0x24e1d8e068620b647ca097f961a61055f4f42d72) |
| MockUSDC (registrar payment, free `mint`)                 | [`0x240b0316df57887dbbe58b586508b19e633a14aa`](https://sepolia.etherscan.io/address/0x240b0316df57887dbbe58b586508b19e633a14aa) |
| **re-charge.eth UserRegistry proxy** (ours)               | [`0x297320862052B1d0e069502c0D5DE12841E2EA41`](https://sepolia.etherscan.io/address/0x297320862052B1d0e069502c0D5DE12841E2EA41) |
| **spike.re-charge.eth PermissionedResolver proxy** (ours) | [`0xe1ea7EC45d82cB79E8DfD959F4aBFe1212e64C1f`](https://sepolia.etherscan.io/address/0xe1ea7EC45d82cB79E8DfD959F4aBFe1212e64C1f) |
| throwaway "sponsor"                                       | [`0x5b38d144Ee217F868C3dC8741a2fa627387FAc72`](https://sepolia.etherscan.io/address/0x5b38d144Ee217F868C3dC8741a2fa627387FAc72) |

`re-charge.eth` was free and is now ours (owner `0x69D0…`, expires 2027-11-06). The fallback
name `recharge-mumbai.eth` was not needed.

## Transactions

All succeeded (status 1) except the one that was meant to revert.

| #   | Step                                                                      | Tx                                                                                                                | Gas used  |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | MockUSDC.mint(0x69D0, 10 USDC)                                            | [0x1a69c99c…](https://sepolia.etherscan.io/tx/0x1a69c99cf63af20eb8c86c51f68d32a759ff96f8cb9c9eaff3df9244b49fc827) | 140,589   |
| 2   | MockUSDC.approve(ETHRegistrar)                                            | [0xd67a3645…](https://sepolia.etherscan.io/tx/0xd67a36457e5617ed7180c77d3164cab61b7b5635d06fc02a3360f9d6f89d5f77) | 128,274   |
| 3   | ETHRegistrar.commit                                                       | [0x92d273e5…](https://sepolia.etherscan.io/tx/0x92d273e57b2c9eae189843990d77c101c99d66db9e6a44c925879daed2d11b1c) | 127,458   |
| 4   | ETHRegistrar.register("re-charge", 1y, MockUSDC): 8.000021 USDC           | [0xc12c8337…](https://sepolia.etherscan.io/tx/0xc12c8337b7d73a983a0de15003a4d7d5a524194fb7de151b217afcd56e6f1199) | 676,749   |
| 5   | VerifiableFactory.deployProxy(UserRegistry, initialize)                   | [0x5de9fb0a…](https://sepolia.etherscan.io/tx/0x5de9fb0a8c027a91ff10dd2743b6ebd8cfd0bbc9a514808ac2d330b59b954361) | 903,034   |
| 6   | ETHRegistry.setSubregistry(labelhash("re-charge"), UserRegistry)          | [0x211a163f…](https://sepolia.etherscan.io/tx/0x211a163f66a1351016f6001487e42ee3ef39d394c62299bf5b0af4990f724f5e) | 139,600   |
| 7   | deployProxy(PermissionedResolver), 4 text records set inside `initialize` | [0xabdfef2c…](https://sepolia.etherscan.io/tx/0xabdfef2cf7b02909c36f47de6b59c9b7e9a4abde9e723c1b6b2e0214c0fe57df) | 2,276,645 |
| 8   | UserRegistry.register("spike", sponsor, 0, resolver, roles 0, now+2d)     | [0x3bb53a46…](https://sepolia.etherscan.io/tx/0x3bb53a46a354e8801c8e33ec7967f6d188af4fa88a29c3a45888ce8f4194976f) | 385,213   |
| 9   | resolver.grantSetterRoles(setText(·,"avatar",·), sponsor)                 | [0xc92c3c80…](https://sepolia.etherscan.io/tx/0xc92c3c80fe87ff67db9ef359a2f4045da64185740b12b012a32e26ddbdbebde7) | 258,220   |
| 10  | fund sponsor 0.01 ETH                                                     | [0xd7e432df…](https://sepolia.etherscan.io/tx/0xd7e432dfe2616898b758bde220b8b43622cb4eefec5c6ccc0bfec2dcf7a96cea) | 204,600   |
| 11  | **sponsor** setText(spike, "avatar"): succeeds                            | [0x062818ef…](https://sepolia.etherscan.io/tx/0x062818ef47d3a7167752a82403b7423776475dd3c08d7d49e0c7705a425341df) | 372,942   |
| 12  | **sponsor** setText(spike, "url"): **reverts** (status 0)                 | [0xa60e08af…](https://sepolia.etherscan.io/tx/0xa60e08af0032cae8c99032c3d0069c317e4cba3bab00b43ab55683b7b71cbb5a) | 33,688    |
| 13  | UserRegistry.register("defaults", resolver = spike's)                     | [0x799fbdc9…](https://sepolia.etherscan.io/tx/0x799fbdc9125b50a91c51418073bf0f98e8ef9884fbe3760e52b46868a11d0420) | 382,349   |
| 14  | setText(defaults, "recharge.terms")                                       | [0xc6e99e7f…](https://sepolia.etherscan.io/tx/0xc6e99e7fcb2700f275e5d80860ef14fa5aaa23f614fd45e59622a8a7f721d4c3) | 495,938   |
| 15  | linkToNode(spike, namehash(defaults))                                     | [0xc6c68093…](https://sepolia.etherscan.io/tx/0xc6c680936585a483149078297b7e6c7d17370fbb416233faf783e187b7ee21c0) | 49,070    |
| 16  | linkToRecord(spike, 1): restore spike's own record                        | [0xfe45c548…](https://sepolia.etherscan.io/tx/0xfe45c54879c5bc0dd60457de409efcaeda09d84c2722b68ec8adf9778f00ea44) | 48,650    |

- **Total gas: 6,623,019.** The ETH spent on gas was 0.00258 from `0x69D0` and 0.0000786 from
  the sponsor, at effective prices between 0.19 and 1 gwei.
- **Remaining ETH:** `0x69D0` has 0.48742 and the throwaway has 0.00992.
- **One-time setup** (steps 1–6) cost 2,115,704 gas.
- **Per campaign** (steps 7+8+9) cost **2,920,078 gas**, which was 0.00086 ETH at this run's prices.

The revert in step 12 is a logic revert, not out-of-gas: 33,688 of the 100,000 gas limit was used.
The same call run as an eth_call returns `EACUnauthorizedAccountRoles(keccak256("url"), 16, sponsor)`.
`check.sh` proves the rest with eth_calls:

- The sponsor has `ROLE_SET_TEXT` on resource `keccak256("avatar")`.
- The sponsor does not have it on `keccak256("url")` or on root.
- An `unsafeTransfer` by the name's owner reverts with `TransferDisallowed(tokenId, owner)`.
- A `safeTransferFrom` reverts with `TransferUnsafeUntilRegistryIsEmancipated()`.
- `VerifiableFactory.verifyContract` returns the genuine implementation for both of our proxies.

Read-back from `read.mjs` (viem 2.57.14, `sepolia` chain, plain `getEnsText`):

```
spike.re-charge.eth
  text url                = https://app.recharge.ajudiya.com/c/spike
  text avatar             = https://app.recharge.ajudiya.com/icon.png      <- written by the sponsor
  text recharge.campaign  = 0x0000000000000000000000000000000000000000000000000000000000000001
  text recharge.pool      = eip155:296:0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6
  text recharge.bundle    = 1 GB · 7 days
  resolver                = 0xe1ea7EC45d82cB79E8DfD959F4aBFe1212e64C1f
  registry expiry         = 1794103094 (2026-11-08T01:58:14Z)   UserRegistry.getExpiry(labelhash("spike"))
  registry owner          = 0x5b38…Fc72 (sponsor; token is non-transferable)
```

## What the API needs per campaign

**Signer.** The API key holds the role bitmaps below. All names are DNS wire-format `bytes`, for
example `0x05 spike 0x09 re-charge 0x03 eth 0x00`. Every setter takes these bytes, not a `bytes32` node.

**Roles.** Each role has a 4-bit slot, and its `_ADMIN` twin sits at `role << 128`. Roles left out
of `initialize` can never be added later, because granting a role needs the matching `_ADMIN`.

| Where                                        | Who             | Bitmap                                            | Roles                                                                                                                      |
| -------------------------------------------- | --------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| UserRegistry root (set once in `initialize`) | API             | `0x101110100000000000000000000000001011101`       | REGISTRAR, SET_PARENT, UNREGISTER, RENEW, SET_RESOLVER, each with its _ADMIN. No UPGRADE, so nobody can upgrade the proxy. |
| Campaign resolver root (in `initialize`)     | API             | `0x1100011100000000000000000000000011000111`      | SET_ADDRESS, SET_TEXT, SET_CONTENTHASH, SET_DATA, LINK, each with its _ADMIN. No UPGRADE.                                  |
| Campaign name token (`register` roleBitmap)  | sponsor (owner) | `0`                                               | None. Without ROLE_CAN_TRANSFER_ADMIN the name is non-transferable, and the token gives no powers.                         |
| Campaign resolver, one key                   | sponsor         | ROLE_SET_TEXT `0x10` on resource `keccak256(key)` | Set with `grantSetterRoles`, one key per grant.                                                                            |

**Per-campaign calls** (3 txs, about 2.9M gas on Sepolia):

1. `salt = keccak256(campaignId)`. Read `resolver = VerifiableFactory.predictProxyAddress(API, salt)`.
   The CREATE2 salt is `keccak256(abi.encode(msg.sender, salt))`, so the address is known before deploying.
   Do not salt with the namehash: a label re-registered after expiry needs a fresh proxy.
2. `VerifiableFactory.deployProxy(PermissionedResolverImpl, salt, initialize([(API, 0x11000111…11000111)], [setText(name,k,v)…]))`.
   This deploys the proxy, grants the API's roles and writes every record in one tx.
   - The resolver skips role checks while initializing. That is why setters inside `calls` work even
     though `msg.sender` is the factory.
   - The empty proxy costs about 817k gas. Each text record adds between 0.36M and 0.6M on Sepolia.
3. `UserRegistry.register(label, sponsor, address(0), resolver, 0, expiry)`. Expiry is an absolute
   unix time. There is no per-name ERC20 fee: our registry, our rules.
4. `resolver.grantSetterRoles(abi.encodeCall(setText, (0x00, key, "")), sponsor)`. Only the selector
   and the key are decoded. Use `resolver.multicall([...])` to grant several keys in one tx.
   - This cannot go inside step 2's `calls`. `grantSetterRoles` still checks admin rights against
     `msg.sender`, which is the factory there. Simulated: `EACCannotGrantRoles(keccak("avatar"), 16, factory)`.
   - A workaround was simulated: add a temporary `(factory, SET_TEXT_ADMIN)` grant, then grant, then
     `revokeRootRoles` it. It works but costs about 115k gas more than the separate tx, so it isn't worth it.

**Later in a campaign's life:**

- **Renew:** `UserRegistry.renew(labelhash, newExpiry)`.
- **Update records:** `resolver.setText(name, k, v)`, or `resolver.multicall`.
- **End early:** `UserRegistry.unregister(labelhash)`.
- **Revoke the sponsor:** `resolver.revokeRoles(keccak256(key), 0x10, sponsor)`.

**Client read.** Use `createPublicClient({ chain: sepolia })` with `getEnsText({ name, key })`. No
custom path: viem's default UR `0xeeee…eeee` already proxies to UniversalResolverV2. For expiry, call
`UserRegistry.getExpiry(uint256(labelhash(label)))`. PermissionedResolver has **no** `text(node,key)`
getter. Reads only work through ENSIP-10 `resolve(name, data)`, which is the call the UR makes.

## Surprises

- **Sepolia gas is not mainnet gas.** Sepolia now charges far more for creating state:
  - A plain ETH transfer to a fresh address used 204,600 gas. `eth_estimateGas` gives 207,391 for a
    fresh address and 21,000 for an existing one.
  - Writing a new storage slot costs about 5× today's mainnet price. A `commit` used 127k gas.
  - The gas figures above are therefore inflated by Sepolia's state pricing. Re-measure on the target chain before quoting costs.
- **The registrar is paid in ERC20 only.** `ETHRegistrar.register` takes MockUSDC or MockDAI, not ETH.
  `re-charge` (9 chars) costs 8.000021 MockUSDC per year. Commit-reveal needs 60 s ≤ age < 24 h.
- **Aliasing replaces the whole record and stays inside one resolver.** After `linkToNode(spike, defaults)`,
  `spike` resolved `recharge.terms` but lost `url`, `avatar` and `recharge.*`. `linkToRecord(spike, 1)` restored them.
  There is no per-key inheritance, and you cannot link to a record held in another resolver contract.
  For shared terms, write `recharge.terms` into each campaign's `initialize` calls, or have clients
  fall back to reading `defaults.re-charge.eth`. Linking only helps for true alias names, such as two
  names for one campaign.
- **Per-key rights cover every name in a resolver.** Roles are scoped by key, not by name. A sponsor
  with `avatar` rights could set `avatar` on any name whose record lives in that resolver. During the
  aliasing test that included `defaults`. So one resolver proxy per campaign is required, and shared
  records must sit in a resolver no sponsor has rights on. The `defaults` name now points at spike's
  resolver. It is a test artifact that expires in 2 days.
- **The public RPC lags.** `ethereum-sepolia-rpc.publicnode.com` is load-balanced:
  - It gave out stale nonces straight after a tx. `spike.sh` retries when that happens.
  - One read was a block behind its write.
  - The API needs local nonce tracking, and reads should wait for 1 confirmation or pin `blockNumber`.
- **No `setParent` call was made.** Forward resolution walks down from the root and doesn't need it.
  Setting it would give the UserRegistry a canonical name, for reverse-from-registry lookups and indexers.
  The API holds ROLE_SET_PARENT, so this is one tx later if wanted.
- **Token IDs change** whenever roles on a token change (`TokenRegenerated`). Index names by labelhash,
  not tokenId. We never grant token roles, so IDs only change on re-registration.

## Blockers

- **None for Sepolia/testnet.**
- **Mainnet** (planned for after submission) cannot use ENSv2 until ENS launches it. Until then the
  options are ENSv1 NameWrapper subnames, where fuses give the same non-transferable effect, or
  waiting for the v2 launch.
- **The API's hot key holds the `_ADMIN` bits.** For production, split them: give `_ADMIN` to a cold
  owner key and only the regular roles to the API.
