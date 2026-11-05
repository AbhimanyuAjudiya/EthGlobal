/** The public surface of `@ethglobal/agent` (INTERFACES §8). */
export {
  agentConfigSchema,
  loadConfig,
  parseAllowList,
  type AgentConfig,
  type AllowedTerms,
} from './config.js';
export { tick, triggerKey, type AgentDeps, type TickResult } from './tick.js';
export {
  createNotifier,
  phraseNotification,
  templateNotification,
  NOTIFY_INSTRUCTION,
  type Notifier,
  type NotificationFacts,
} from './notifier.js';
export { buildAgent, type Agent, type BuildOptions } from './deps.js';
export { Buyer, TermsGuard, type BuyOutcome } from './buyer.js';
export { EvmPayer, AnvilEvmSigner } from './payers/evm.js';
export { PayerRefusal, type Payer } from './payers/types.js';
export { resolveUaid, uaidInput, AGENT_VERSION } from './identity.js';
export { ReceiptWriter } from './receipts.js';
export { runPass, runLoop } from './loop.js';
