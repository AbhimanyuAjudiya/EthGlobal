import { encodePacked, keccak256 as viemKeccak } from 'viem';
import { describe, expect, it } from 'vitest';

import { concat, hexToBytes, hmacKey, keccak256 } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { CAMPAIGN_ID, NULLIFIER, OTHER_SECRET, SECRET } from './helpers.js';
import { auditKey, campaignClaimKey, onchainClaimKey, quotaKey } from '../src/index.js';

const OTHER_CAMPAIGN: Hex = `0x${'cd'.repeat(32)}`;

describe('keys', () => {
  it('quotaKey deterministic', () => {
    expect(quotaKey(SECRET, NULLIFIER)).toBe(quotaKey(SECRET, NULLIFIER));
    expect(quotaKey(SECRET, NULLIFIER)).toBe(hmacKey(SECRET, 'quota', hexToBytes(NULLIFIER)));
    expect(quotaKey(SECRET, NULLIFIER.toUpperCase().replace('0X', '0x') as Hex)).toBe(
      quotaKey(SECRET, NULLIFIER),
    );
  });

  it('distinct secrets ⇒ distinct keys', () => {
    expect(quotaKey(SECRET, NULLIFIER)).not.toBe(quotaKey(OTHER_SECRET, NULLIFIER));
    expect(auditKey(SECRET, CAMPAIGN_ID)).not.toEqual(auditKey(OTHER_SECRET, CAMPAIGN_ID));
  });

  it('nullifier substring absent from every output (O12)', () => {
    const audit = auditKey(SECRET, CAMPAIGN_ID);
    const cck = campaignClaimKey(audit, NULLIFIER);
    const outputs = [quotaKey(SECRET, NULLIFIER), cck, onchainClaimKey(CAMPAIGN_ID, cck)];
    for (const out of outputs) expect(out.toLowerCase()).not.toContain('c3c3c3c3c3c3');
    expect(quotaKey(SECRET, NULLIFIER)).not.toBe(campaignClaimKey(SECRET, NULLIFIER)); // domain-separated
  });

  it('onchainClaimKey equals keccak256(abi.encodePacked) vector from fixtures/eip3009/… or a viem encodePacked check', () => {
    const cck = campaignClaimKey(auditKey(SECRET, CAMPAIGN_ID), NULLIFIER);
    const packed = viemKeccak(encodePacked(['bytes32', 'bytes32'], [CAMPAIGN_ID, cck]));
    expect(onchainClaimKey(CAMPAIGN_ID, cck)).toBe(packed);
    expect(onchainClaimKey(CAMPAIGN_ID, cck)).toBe(
      keccak256(concat(hexToBytes(CAMPAIGN_ID), hexToBytes(cck))),
    );
  });

  it('auditKey differs per campaign', () => {
    const a = auditKey(SECRET, CAMPAIGN_ID);
    expect(a).toHaveLength(32);
    expect(campaignClaimKey(a, NULLIFIER)).not.toBe(
      campaignClaimKey(auditKey(SECRET, OTHER_CAMPAIGN), NULLIFIER),
    );
  });

  it('a secret shorter than 32 bytes is refused', () => {
    const weak = new Uint8Array(16).fill(7);
    expect(() => quotaKey(weak, NULLIFIER)).toThrow(
      expect.objectContaining({ code: 'internal_error' }),
    );
    expect(() => auditKey(weak, CAMPAIGN_ID)).toThrow();
    expect(() => campaignClaimKey(weak, NULLIFIER)).toThrow();
    expect(() => quotaKey('x'.repeat(40) as unknown as Uint8Array, NULLIFIER)).toThrow();
  });

  it.each(['0x1234', 'c3'.repeat(32), `0x${'zz'.repeat(32)}`, 42])(
    'non-hex32 input %j → invalid_request',
    (bad) => {
      expect(() => quotaKey(SECRET, bad as Hex)).toThrow(
        expect.objectContaining({ code: 'invalid_request' }),
      );
      expect(() => onchainClaimKey(bad as Hex, NULLIFIER)).toThrow();
    },
  );
});
