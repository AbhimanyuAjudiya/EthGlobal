import { describe, expect, it } from 'vitest';

import type { VerificationLevel } from '@ethglobal/protocol/schemas';

import { tierFromLevel } from '../src/index.js';

describe('tierFromLevel', () => {
  it.each([
    ['orb', 'orb'],
    ['document', 'document'],
    ['secure_document', 'document'],
    ['device', 'device'],
  ] as const)('%s → %s', (level, tier) => expect(tierFromLevel(level)).toBe(tier));

  it.each(['selfie', 'unknown', '', 'ORB', 'toString', '__proto__'])(
    'an unknown level (%j) is none, never orb/document',
    (level) => expect(tierFromLevel(level as VerificationLevel)).toBe('none'),
  );
});
