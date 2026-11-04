/**
 * HCS `agent-topup` receipts (INTERFACES §1.7; T-44, T-77). The message carries sha256(key) — never the key — and the
 * agent's UAID; `encodeHcsMessage` validates it and refuses > 1024 bytes. Locally the port is MockConsensusLog; live it
 * is the Agent Kit's SUBMIT_TOPIC_MESSAGE_TOOL (src/payers/hedera.ts). A failed submit is logged and never retried
 * as a purchase. The agent writes nothing to Arkiv: the API records the ledger receipt from the X-Agent-Uaid header.
 */
import type { ConsensusLog } from '@ethglobal/adapters';
import { sha256Hex } from '@ethglobal/crypto';
import { encodeHcsMessage } from '@ethglobal/protocol/schemas';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { logEvent, type Log } from './log.js';

export interface TopUpReceipt {
  key: string;
  network: string;
  tx: string;
  usd6: bigint;
  mb: number;
  reason: 'threshold' | 'expiry';
}

export class ReceiptWriter {
  constructor(
    private readonly opts: {
      consensus: ConsensusLog;
      topic: string;
      uaid: string;
      now: () => number;
      log: Log;
    },
  ) {}

  /** The exact HCS message text for a purchase (validated, ≤ 1024 bytes). */
  message(r: TopUpReceipt): string {
    return encodeHcsMessage({
      v: 1,
      t: 'agent-topup',
      at: new Date(this.opts.now()).toISOString(),
      svc: 'agent',
      ent: sha256Hex(r.key),
      uaid: this.opts.uaid,
      network: r.network,
      tx: r.tx,
      usd6: usd6ToWire(r.usd6),
      mb: r.mb,
      reason: r.reason,
    });
  }

  /** Submits the receipt; returns the HCS sequence number, or undefined when the submit failed (logged). */
  async submit(r: TopUpReceipt): Promise<number | undefined> {
    try {
      const { sequence } = await this.opts.consensus.submit(this.opts.topic, this.message(r));
      return sequence > 0 ? sequence : undefined;
    } catch (error) {
      logEvent(this.opts.log, 'warn', 'degraded', {
        what: 'hcs-submit',
        topic: this.opts.topic,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
