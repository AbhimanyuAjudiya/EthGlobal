import { readdirSync } from 'node:fs';

import { PaymentPayloadV2Schema, PaymentRequirementsV2Schema } from '@x402/core/schemas';
import { describe, expect, it, vi } from 'vitest';

import {
  RemoteFacilitator,
  mirrorTransactionId,
  plausibleTransaction,
} from '../../src/live/remote-facilitator.js';
import { RoutingPaymentRail } from '../../src/live/routing-rail.js';
import {
  fixtureFetch,
  fixturePath,
  loadFixture,
  requirementInput,
  type Recording,
} from '../../src/testing/index.js';

import type { PaymentPayload, PaymentRequirements } from '../../src/types.js';

interface Body {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}
const bodyOf = (file: string, path: '/verify' | '/settle' = '/settle'): Body =>
  loadFixture<Recording>(file).exchanges.find((e) => e.request.url.endsWith(path))!.request
    .body as Body;
const evm = bodyOf('facilitator/x402org/settle-ok.json');
const hedera = bodyOf('facilitator/hedera/settle-ok.json');

const x402 = (
  file: string,
  over: Partial<ConstructorParameters<typeof RemoteFacilitator>[0]> = {},
) =>
  new RemoteFacilitator({
    url: 'https://x402.org/facilitator',
    fetch: fixtureFetch(`facilitator/x402org/${file}.json`, { strictBody: true }),
    allowedHosts: ['x402.org'],
    networks: ['eip155:84532', 'hedera:testnet'],
    ...over,
  });
const blocky = (
  file: string,
  over: Partial<ConstructorParameters<typeof RemoteFacilitator>[0]> = {},
) =>
  new RemoteFacilitator({
    url: 'https://api.testnet.blocky402.com',
    fetch: fixtureFetch(`facilitator/hedera/${file}.json`, { strictBody: true }),
    allowedHosts: ['api.testnet.blocky402.com'],
    networks: ['hedera:testnet'],
    mirrorUrl: 'https://testnet.mirrornode.hedera.com',
    sleep: async () => undefined,
    ...over,
  });

describe('RemoteFacilitator (A-18, A-20, A-30; T-42)', () => {
  it('verify/settle request bodies match the spec (strictBody) and carry amount, never maxAmountRequired', async () => {
    await expect(
      x402('verify-ok').verify(evm.paymentPayload, evm.paymentRequirements),
    ).resolves.toEqual({
      isValid: true,
      payer: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    });
    await expect(
      x402('settle-ok').settle(evm.paymentPayload, evm.paymentRequirements),
    ).resolves.toMatchObject({
      success: true,
      network: 'eip155:84532',
      transaction: `0x${'9e'.repeat(32)}`,
    });
    const text = readdirSync(fixturePath('facilitator/x402org'))
      .map((f) => JSON.stringify(loadFixture(`facilitator/x402org/${f}`)))
      .join('');
    expect(text).not.toContain('maxAmountRequired');
    expect(evm.paymentRequirements.amount).toBe('1000000');
    expect(evm.paymentRequirements.extra).toEqual({ name: 'USDC', version: '2' });
  });

  it('@x402/core 2.29.0 decodes every fixture request body (A-19 conformance)', () => {
    for (const dir of ['x402org', 'hedera']) {
      for (const file of readdirSync(fixturePath(`facilitator/${dir}`))) {
        for (const { request } of loadFixture<Recording>(`facilitator/${dir}/${file}`).exchanges) {
          if (request.method !== 'POST') continue;
          const body = request.body as Body;
          expect(PaymentPayloadV2Schema.safeParse(body.paymentPayload).success).toBe(true);
          expect(PaymentRequirementsV2Schema.safeParse(body.paymentRequirements).success).toBe(
            true,
          );
        }
      }
    }
  });

  it('supported gate: a network the facilitator does not list ⇒ unavailable at first use', async () => {
    const warn = vi.fn();
    const f = x402('supported-evm-only', { logger: { warn } });
    await expect(f.verify(hedera.paymentPayload, hedera.paymentRequirements)).rejects.toMatchObject(
      { code: 'unavailable' },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/does not list exact on hedera:testnet/),
    );
  });

  it('Hedera feePayer read from /supported and pinned by expectFeePayer (T-42)', async () => {
    await expect(x402('supported').feePayer('hedera:testnet')).resolves.toBe('0.0.9185802');
    await expect(
      x402('supported', { expectFeePayer: { 'hedera:testnet': '0.0.9185802' } }).feePayer(
        'hedera:testnet',
      ),
    ).resolves.toBe('0.0.9185802');
    await expect(
      x402('supported-other-fee-payer', {
        expectFeePayer: { 'hedera:testnet': '0.0.9185802' },
      }).feePayer('hedera:testnet'),
    ).rejects.toMatchObject({ code: 'invalid_response', details: { feePayer: '0.0.6666666' } });
    await expect(x402('supported').feePayer('eip155:84532')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('createPaymentRequirement fills extra.feePayer from /supported and refuses a different one', async () => {
    const f = blocky('supported');
    await f.feePayer('hedera:testnet');
    const input = requirementInput({
      network: 'hedera:testnet',
      asset: '0.0.429274',
      payTo: '0.0.5005',
      maxTimeoutSeconds: 180,
      extra: {},
    });
    expect(
      f.createPaymentRequirement({ ...input, extra: undefined as never }).accepts[0]!.extra,
    ).toEqual({ feePayer: '0.0.7162784' });
    expect(() => f.createPaymentRequirement({ ...input, extra: { feePayer: '0.0.1' } })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() => f.createPaymentRequirement(requirementInput())).toThrow(
      expect.objectContaining({ code: 'unsupported_scheme' }),
    );
  });

  it('Hedera: settle transaction 0.0.x@s.n accepted; transactionId normalised into transaction; a 32-byte hex ⇒ invalid_response', async () => {
    await expect(
      blocky('verify-ok').verify(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toMatchObject({ isValid: true });
    await expect(
      blocky('settle-ok').settle(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toMatchObject({
      success: true,
      transaction: '0.0.7162784@1793707200.123456789',
    });
    await expect(
      blocky('settle-transaction-id').settle(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toMatchObject({
      success: true,
      transaction: '0.0.7162784@1793707200.123456789',
    });
    await expect(
      blocky('settle-evm-hash').settle(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toMatchObject({
      success: false,
      errorReason: 'invalid_response',
    });
  });

  it('settlement_pending polled then resolved (Hedera mirror; EVM receipt)', async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(
      blocky('settle-pending', { sleep }).settle(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toEqual({
      success: true,
      transaction: '0.0.7162784@1793707200.123456789',
      network: 'hedera:testnet',
      payer: '0.0.6006',
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    const receipts = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('success');
    await expect(
      x402('settle-pending', { evmReceipts: { receipt: receipts }, sleep }).settle(
        evm.paymentPayload,
        evm.paymentRequirements,
      ),
    ).resolves.toMatchObject({ success: true, transaction: `0x${'9e'.repeat(32)}` });
    const reverted = vi.fn().mockResolvedValue('reverted');
    await expect(
      x402('settle-pending', { evmReceipts: { receipt: reverted } }).settle(
        evm.paymentPayload,
        evm.paymentRequirements,
      ),
    ).resolves.toMatchObject({ success: false, errorReason: 'settle_reverted' });
    let t = 0;
    const never = vi.fn().mockResolvedValue(null);
    await expect(
      x402('settle-pending', {
        evmReceipts: { receipt: never },
        now: () => (t += 10_000),
        sleep,
      }).settle(evm.paymentPayload, evm.paymentRequirements),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      x402('settle-pending').settle(evm.paymentPayload, evm.paymentRequirements),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each([
    ['settle-no-tx', 'invalid_response'],
    ['settle-foreign-network', 'network_mismatch'],
    ['settle-malformed', 'invalid_response'],
    ['settle-nonce-used', 'invalid_transaction_state'],
  ])('%s ⇒ success:false %s (L10) — never success', async (file, errorReason) => {
    const warn = vi.fn();
    const result = await x402(file, { logger: { warn } }).settle(
      evm.paymentPayload,
      evm.paymentRequirements,
    );
    expect(result).toMatchObject({ success: false, errorReason, network: 'eip155:84532' });
  });

  it('verify-invalid ⇒ isValid:false with the reason', async () => {
    await expect(
      x402('verify-invalid').verify(evm.paymentPayload, evm.paymentRequirements),
    ).resolves.toMatchObject({
      isValid: false,
      invalidReason: 'invalid_exact_evm_payload_signature',
    });
  });

  it('local prechecks: unconfigured network / payload kind of another network / pre-A-20 Hedera shape / mismatch — no request', async () => {
    const noFetch = vi.fn();
    const f = new RemoteFacilitator({
      url: 'https://x402.org/facilitator',
      fetch: noFetch,
      allowedHosts: ['x402.org'],
      networks: ['eip155:84532'],
    });
    await expect(
      f.verify(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toMatchObject({ invalidReason: 'unsupported_scheme' });
    const hederaOnEvm = {
      ...evm.paymentPayload,
      payload: { transaction: 'AAAA' },
    } as PaymentPayload;
    await expect(f.verify(hederaOnEvm, evm.paymentRequirements)).resolves.toMatchObject({
      invalidReason: 'unsupported_scheme',
    });
    await expect(f.settle(hederaOnEvm, evm.paymentRequirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'unsupported_scheme',
    });
    const h = blocky('supported');
    const legacy = {
      ...hedera.paymentPayload,
      payload: { signedTransaction: 'AAAA', memo: 'x' },
    } as unknown as PaymentPayload;
    await expect(h.verify(legacy, hedera.paymentRequirements)).resolves.toMatchObject({
      invalidReason: 'invalid_payload',
    });
    const other = { ...evm.paymentRequirements, amount: '1' };
    await expect(f.verify(evm.paymentPayload, other)).resolves.toMatchObject({
      invalidReason: 'requirements_mismatch',
    });
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('host outside the allow-list ⇒ constructor throws; plain http only for localhost', () => {
    const base = { allowedHosts: ['x402.org', 'attacker.example'], networks: ['eip155:84532'] };
    expect(() => new RemoteFacilitator({ ...base, url: 'http://attacker.example/' })).toThrow();
    expect(() => new RemoteFacilitator({ ...base, url: 'https://attacker.example/' })).toThrow(
      /not an allowed host/,
    );
    expect(() => new RemoteFacilitator({ ...base, url: 'http://x402.org/facilitator' })).toThrow(
      /https/,
    );
    expect(
      () => new RemoteFacilitator({ ...base, url: 'https://x402.org/facilitator', networks: [] }),
    ).toThrow(/network/);
    expect(
      () =>
        new RemoteFacilitator({
          ...base,
          allowedHosts: ['localhost'],
          url: 'http://localhost:8787/facilitator',
        }),
    ).not.toThrow();
  });

  it('a /supported outage is unavailable and retried on the next call', async () => {
    let calls = 0;
    const flaky: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ kinds: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const f = new RemoteFacilitator({
      url: 'https://x402.org/facilitator',
      fetch: flaky,
      allowedHosts: ['x402.org'],
      networks: ['eip155:84532'],
    });
    await expect(f.supported()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.supported()).resolves.toEqual({ kinds: [] });
  });

  it('RoutingPaymentRail({ evm, hedera }) routes by accepted.network', async () => {
    const routing = new RoutingPaymentRail({
      'eip155:84532': x402('settle-ok'),
      'hedera:testnet': blocky('settle-ok'),
    });
    await expect(
      routing.settle(hedera.paymentPayload, hedera.paymentRequirements),
    ).resolves.toMatchObject({ network: 'hedera:testnet', success: true });
    await expect(
      routing.settle(evm.paymentPayload, evm.paymentRequirements),
    ).resolves.toMatchObject({ network: 'eip155:84532', success: true });
  });

  it('plausibleTransaction and mirror ids', () => {
    expect(plausibleTransaction('eip155:1', `0x${'a'.repeat(64)}`)).toBe(true);
    expect(plausibleTransaction('hedera:testnet', `0x${'a'.repeat(96)}`)).toBe(true);
    expect(plausibleTransaction('hedera:testnet', '0.0.1@1.2')).toBe(true);
    expect(plausibleTransaction('solana:x', 'abc')).toBe(false);
    expect(plausibleTransaction('eip155:1', undefined)).toBe(false);
    expect(mirrorTransactionId('0.0.7@1700000000.000000001')).toBe('0.0.7-1700000000-000000001');
  });
});
