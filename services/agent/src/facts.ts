/** The only object an LLM ever sees; no free text (INTERFACES §8, T-55). Numbers and one enum. */
export interface NotificationFacts {
  mbRemaining: number;
  mbTotal: number;
  expiresAt: number;
  boughtMb: number;
  spentTodayUsd6: string;
  capUsd6: string;
  reason: 'threshold' | 'expiry' | 'cap' | 'paused';
}
