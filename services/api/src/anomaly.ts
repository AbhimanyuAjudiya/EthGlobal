import type { Hex } from '@ethglobal/protocol/ids';

import type { DataDropClient } from './chain.js';
import type { Logger } from './logger.js';

const WINDOW_MS = 10 * 60_000;
const THRESHOLD = 0.8;

/**
 * T-01: at ≥ 80 % of `claimsPerHour` within 10 minutes the attestor pauses the campaign (`pause(id, true)`, the one
 * pause the attestor may make) and logs `event: 'anomaly'`; the sponsor unpauses from the dashboard.
 */
export class AnomalyGuard {
  readonly #claims = new Map<string, number[]>();
  readonly #paused = new Set<string>();

  constructor(
    private readonly dataDrop: DataDropClient,
    private readonly logger: Logger,
    private readonly now: () => number,
  ) {}

  /** Records one confirmed claim; resolves once the pause (if any) has been sent. Never throws. */
  async record(campaignId: Hex, claimsPerHour: number): Promise<boolean> {
    const id = campaignId.toLowerCase();
    const now = this.now();
    const recent = (this.#claims.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    this.#claims.set(id, recent);
    if (this.#paused.has(id) || recent.length < Math.ceil(THRESHOLD * claimsPerHour)) return false;
    this.#paused.add(id);
    this.logger.warn(
      { event: 'anomaly', campaignId: id, claims: recent.length, claimsPerHour },
      'anomaly: pausing campaign',
    );
    try {
      await this.dataDrop.pause(campaignId, true);
      return true;
    } catch (error) {
      this.#paused.delete(id);
      this.logger.error(
        { event: 'anomaly', campaignId: id, err: errName(error) },
        'anomaly: pause failed',
      );
      return false;
    }
  }
}

const errName = (error: unknown): string => (error instanceof Error ? error.name : 'error');
