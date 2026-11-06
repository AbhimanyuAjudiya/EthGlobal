/** The pino redact list is the safety net under T-50 (the control is that nothing logs these values). */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@ethglobal/crypto';
import { nativePayerBinding } from '@ethglobal/protocol/typed-data';

import { harness } from './support/harness.js';
import { createLogger, REDACT_PATHS } from '../src/logger.js';

describe('logger', () => {
  it('redacts secret-shaped fields at the top level and one level down', () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (l: string) => void lines.push(l) });
    logger.info(
      {
        lpa: 'LPA:1$x$y',
        pin: '1234',
        nested: { proof: ['0x1'], signature: '0xsig', nullifier: '123' },
        headers: { authorization: 'Recharge-Sponsor abc' },
      },
      'm',
    );
    const line = lines.join('');
    expect(line).not.toMatch(/LPA:|1234|0xsig|Recharge-Sponsor|"0x1"/);
    expect(line).toContain('[redacted]');
    expect(JSON.parse(line)).toMatchObject({ service: 'api', msg: 'm' });
    expect(REDACT_PATHS).toEqual(expect.arrayContaining(['*.sealedLpa', '*.auditKey', '*.token']));
  });

  it('redacts native wallet signature maps at the top level and one level down', () => {
    const lines: string[] = [];
    const signatureMap = Buffer.from('fake-native-wallet-proof-for-redaction').toString('base64');
    const logger = createLogger('info', { write: (line: string) => void lines.push(line) });
    logger.info({ signatureMap, request: { signatureMap } }, 'native proof safety net');
    expect(lines.join('')).not.toContain(signatureMap);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      signatureMap: '[redacted]',
      request: { signatureMap: '[redacted]' },
    });
  });

  it('never echoes native proof contents in validation or authorization errors and request logs', async () => {
    const h = await harness();
    const payer = '0.0.7001';
    const network = 'hedera:testnet';
    const fakeProof = Buffer.from('fake-native-wallet-proof-for-error-path').toString('base64');
    for (const [signatureMap, expectedStatus] of [
      [`${fakeProof}!`, 400],
      [fakeProof, 401],
    ] as const) {
      const challenge = await h.challengeFor(
        '/plan/cancel',
        sha256Hex(nativePayerBinding(network, payer)),
      );
      const response = await h.json('/plan/cancel', {
        authKind: 'hedera',
        entitlementKey: 'paid:private-test-plan',
        payer,
        network,
        challenge,
        issuedAt: h.clock.now(),
        signatureMap,
      });
      expect(response.status).toBe(expectedStatus);
      expect(await response.text()).not.toContain(fakeProof);
    }
    expect(h.lines.join('')).not.toContain(fakeProof);
  });
});
