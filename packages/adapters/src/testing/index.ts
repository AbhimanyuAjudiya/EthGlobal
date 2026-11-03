/**
 * `@ethglobal/adapters/testing` (INTERFACES §3.4): the one home of test helpers (ARCHITECTURE §8 row 10).
 * Node only (fixtures are read from disk). The port contract suites (`describeLedger`, …) are added by the
 * adapters-live workstream.
 */
export { T0, fakeClock } from './clock.js';
export { anvilAccounts, anvilKeys, anvilRoles } from './anvil.js';
export { loadFixture, fixturePath } from './fixtures.js';
export {
  fixtureFetch,
  FixtureMiss,
  type Recording,
  type RecordedRequest,
  type RecordedResponse,
} from './fixture-fetch.js';
export { fixtureProof, paymentPayload, requirementInput, TEST_USDC } from './builders.js';
export * from './contracts/index.js';
export { FakeArkiv, arkivFixtureClient, type ArkivCall } from './arkiv.js';
export { FakeUsdc3009, type FakeTransfer, type FakeUsdcOptions } from './evm.js';
