/**
 * MODE=local only (RT-W-12): the e2e tamper hook (`globalThis.__RECHARGE_TEST__`, set by topup.spec through
 * addInitScript). Imported only behind a literal `process.env.NEXT_PUBLIC_MODE === 'local'` (PaySheet), so a live
 * bundle has no hook to set.
 */
export interface TestHooks {
  tamperAmount?: boolean;
}

export const testHooks = (): TestHooks =>
  (globalThis as { __RECHARGE_TEST__?: TestHooks }).__RECHARGE_TEST__ ?? {};
