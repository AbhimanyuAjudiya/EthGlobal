# @ethglobal/adapters

Interfaces for the sponsor integrations plus deterministic in-memory mocks. `createAdapters('local')`
returns the mocks; `createAdapters('live')` throws until the live implementations land after the product
decision. Nothing here touches the network.

| Interface                                                         | Modelled on                                                             | Mock behaviour                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ledger` — `put / get / query` with optional `expiresIn`          | Arkiv entity API (payload + annotations + BTL)                          | Sequential keys `ent_000001…`, equality queries over annotations, expiry from an injectable clock                                                                      |
| `Personhood` — `verify(proof, {action, signal})`                  | World ID IDKit success result + cloud verifier                          | Validates shape, enforces one verification per (action, nullifier)                                                                                                     |
| `PaymentRail` — `createPaymentRequirement / verify / settle`      | x402 v2 (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`) | Checks requirements, recipient, amount, validity window and nonce; `settle` burns the nonce and returns a deterministic tx hash. Header encode/decode helpers included |
| `Inference` — `complete(prompt)` → `{text, requestId, signature}` | 0G Compute (signed responses)                                           | Echo responder (overridable), sha256-derived ids and signatures                                                                                                        |
| `NameResolver` — `resolve(name)`, `getText(name, key)`            | ENS                                                                     | Fixture records (`alice.eth`, `bob.eth` → Anvil accounts 0/1), lower-case normalisation                                                                                |

```ts
import { createAdapters, parseAdapterMode } from '@ethglobal/adapters';

const adapters = createAdapters(parseAdapterMode(process.env['MODE']));
const { key } = await adapters.ledger.put({
  payload: '…',
  annotations: { type: 'receipt' },
  expiresIn: 3600,
});
```

Build output goes to `dist/` (`pnpm build`); consumers import the compiled package. Tests: `pnpm test`.
