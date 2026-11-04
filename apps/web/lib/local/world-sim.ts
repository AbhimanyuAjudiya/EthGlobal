/**
 * MODE=local only (RT-W-12): the API's simulated IDKit 4 result (`POST /__local/world-proof`, never built in the
 * browser). Imported only behind a literal `process.env.NEXT_PUBLIC_MODE === 'local'` (VerifySheet), so the live
 * bundle carries neither the call nor the route path.
 */
import type { Hex } from '@ethglobal/protocol/ids';
import type { PersonhoodProof } from '@ethglobal/protocol/schemas';

import { call } from '../api';

export const simulatedProof = async (
  signal: Hex,
  level: 'orb' | 'document' | 'device',
  seed: string,
): Promise<PersonhoodProof> =>
  (await call<PersonhoodProof>('/__local/world-proof', { body: { signal, level, seed } })).data;
