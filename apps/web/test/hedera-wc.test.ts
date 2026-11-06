import { proto } from '@hiero-ledger/proto';
import { createClientHederaSigner, inspectHederaTransaction, PrivateKey } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PaymentRequirements } from '@ethglobal/protocol/schemas';
import { hederaSessionMemo } from '@ethglobal/protocol/x402';

import {
  assembleTransaction,
  hashPackSigner,
  hashPackMessageSigner,
  HashPackPaySigner,
  sessionAccount,
  transferBodyBytes,
  supportsNativeMethods,
} from '../lib/hedera-wc';

// a throwaway ED25519 key for this file only (deterministic signatures, so the bytes compare)
const key = PrivateKey.generateED25519();
const USER = '0.0.7001';
const req = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: 'exact',
  network: 'hedera:testnet',
  asset: '0.0.429274',
  amount: '400000',
  payTo: '0.0.5005',
  maxTimeoutSeconds: 180,
  extra: { feePayer: '0.0.9185802' },
  ...over,
});
const NOW = 1_790_000_000_123;

/** A wallet over the same key: signs exactly the body it is sent, answers a base64 SignatureMap (HIP-820). */
const wallet = vi.fn(async ({ request }: { request: { params: unknown } }) => {
  const body = Buffer.from(
    (request.params as { transactionBody: string }).transactionBody,
    'base64',
  );
  const sigPair = (
    key.publicKey as unknown as { _toProtobufSignature(s: Uint8Array): proto.ISignaturePair }
  )._toProtobufSignature(key.sign(body));
  return {
    signatureMap: Buffer.from(proto.SignatureMap.encode({ sigPair: [sigPair] }).finish()).toString(
      'base64',
    ),
  };
});
const session = { topic: 't1', chain: 'hedera:testnet' as const, accountId: USER };

afterEach(() => vi.restoreAllMocks());

describe('hedera-wc', () => {
  it('is byte-equal to the @x402/hedera reference signer (one node, pinned clock and random)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    // nodeUrl constrains the reference to node 0.0.3, the one node hedera-wc uses
    const signRef = (r: PaymentRequirements) =>
      createClientHederaSigner(USER, key, {
        network: 'hedera:testnet',
        nodeUrl: '127.0.0.1:50211',
      }).createPartiallySignedTransferTransaction(r as never);
    const ours = hashPackSigner(session, wallet);
    const reference = await signRef(req());
    const mine = await ours.createPartiallySignedTransferTransaction(req());
    expect(mine).toBe(reference);
    // payTo above the payer: the legs are sorted by account, as the SDK does
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 1000);
    const up = req({ payTo: '0.0.99999' });
    expect(await ours.createPartiallySignedTransferTransaction(up)).toBe(await signRef(up));
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    // and through the scheme services/agent uses
    const scheme = new ExactHederaScheme(ours as never);
    const built = await scheme.createPaymentPayload(2, { ...req(), extra: req().extra! } as never);
    expect(built.payload).toEqual({ transaction: reference });
    const tx = inspectHederaTransaction(mine);
    expect(tx.transactionIdAccountId).toBe('0.0.9185802');
    expect(tx.tokenTransfers).toEqual({
      '0.0.429274': [
        { accountId: '0.0.5005', amount: '400000' },
        { accountId: USER, amount: '-400000' },
      ],
    });
  });

  it('refuses malformed terms and a session on another network before the wallet opens', async () => {
    wallet.mockClear();
    const s = hashPackSigner(session, wallet);
    for (const bad of [
      req({ network: 'hedera:mainnet' }),
      req({ scheme: 'upto' as never }),
      req({ amount: '0' }),
      req({ amount: '-1' }),
      req({ amount: '1.5' }),
      req({ amount: '99999999999999999' }),
      req({ payTo: 'evil' }),
      req({ payTo: USER }),
      req({ asset: '0.0.0' + 'x' }),
      req({ extra: {} }),
      req({ extra: { feePayer: USER } }),
    ])
      await expect(s.createPartiallySignedTransferTransaction(bad)).rejects.toThrow();
    await expect(
      hashPackSigner(
        session,
        wallet as never,
        () => false,
      ).createPartiallySignedTransferTransaction(req()),
    ).rejects.toThrow('ended');
    expect(() => transferBodyBytes(req(), '0.0.1;0.0.2')).toThrow();
    expect(wallet).not.toHaveBeenCalled();
  });

  it('assembles only our body: an empty or non-string wallet answer fails', async () => {
    const body = transferBodyBytes(req(), USER, NOW);
    expect(() => assembleTransaction(body, new Uint8Array())).toThrow('no signature');
    const s = hashPackSigner(session, async () => ({ signatureMap: 7 }));
    await expect(s.createPartiallySignedTransferTransaction(req())).rejects.toThrow('signatureMap');
  });

  it('accepts exactly one account on the requested chain', () => {
    const ns = (accounts: string[]) => ({
      namespaces: { hedera: { accounts, methods: [], events: [] } },
    });
    expect(sessionAccount(ns(['hedera:testnet:0.0.7001']), 'hedera:testnet')).toBe(USER);
    expect(sessionAccount(ns(['hedera:mainnet:0.0.7001']), 'hedera:testnet')).toBeUndefined();
    expect(
      sessionAccount(ns(['hedera:testnet:0.0.1', 'hedera:testnet:0.0.2']), 'hedera:testnet'),
    ).toBeUndefined();
    expect(sessionAccount(ns(['hedera:testnet:0.0.x']), 'hedera:testnet')).toBeUndefined();
    expect(sessionAccount({ namespaces: {} }, 'hedera:testnet')).toBeUndefined();
  });

  it('chooses only allow-listed offers with explicit native session binding for new plans', () => {
    const allow = [{ network: 'hedera:testnet', asset: '0.0.429274', payTo: '0.0.5005' }];
    const p = new HashPackPaySigner(hashPackSigner(session, wallet), 'hedera:testnet', allow);
    expect(p.choose([req({ network: 'eip155:84532' }), req()])).toEqual(req());
    expect(p.choose([req({ payTo: '0.0.6006' })])).toBeUndefined();
    expect(p.choose([req({ maxTimeoutSeconds: 600 })])).toBeUndefined();
    expect(
      p.choose([req({ extra: { feePayer: '0.0.9185802', sessionKeyRequired: true } })]),
    ).toBeUndefined();
    const bound = req({
      extra: {
        feePayer: '0.0.9185802',
        sessionKeyRequired: true,
        sessionBinding: 'hedera-memo-v1',
      },
    });
    expect(p.choose([bound])).toEqual(bound);
  });

  it('binds the activation session in the signed body and rejects ambiguous envelopes', async () => {
    const bound = req({
      extra: {
        feePayer: '0.0.9185802',
        sessionKeyRequired: true,
        sessionBinding: 'hedera-memo-v1',
      },
    });
    const signer = new HashPackPaySigner(hashPackSigner(session, wallet), session.chain, [bound]);
    const nonce = `0x${'ab'.repeat(32)}` as const;
    await expect(
      signer.sign(bound, {
        resource: {
          url: 'https://api/esim/provision',
          description: 'new plan',
          mimeType: 'application/json',
        },
      }),
    ).rejects.toThrow('session binding');
    const paid = await signer.sign(bound, {
      resource: {
        url: 'https://api/esim/provision',
        description: 'new plan',
        mimeType: 'application/json',
      },
      nonce,
    });

    if (!('transaction' in paid.payload)) throw new Error('missing native transaction');
    const list = proto.TransactionList.decode(Buffer.from(paid.payload.transaction, 'base64'));
    const tx = proto.SignedTransaction.decode(list.transactionList[0]!.signedTransactionBytes!);
    const body = proto.TransactionBody.decode(tx.bodyBytes);
    expect(signer.sessionBinding(paid)).toBe(nonce);
    expect(body.memo).toBe(hederaSessionMemo(nonce));
    const sig = tx.sigMap!.sigPair![0]!.ed25519!;
    expect(key.publicKey.verify(tx.bodyBytes, sig)).toBe(true);
    body.memo = hederaSessionMemo(`0x${'cd'.repeat(32)}`);
    expect(key.publicKey.verify(proto.TransactionBody.encode(body).finish(), sig)).toBe(false);
    const multiple = proto.TransactionList.encode({
      transactionList: [list.transactionList[0]!, list.transactionList[0]!],
    }).finish();
    expect(
      signer.sessionBinding({
        ...paid,
        payload: { transaction: Buffer.from(multiple).toString('base64') },
      }),
    ).toBeUndefined();
    const duplicateBody = Uint8Array.from([...tx.bodyBytes, ...tx.bodyBytes]);
    expect(
      signer.sessionBinding({
        ...paid,
        payload: {
          transaction: Buffer.from(
            assembleTransaction(duplicateBody, proto.SignatureMap.encode(tx.sigMap!).finish()),
          ).toString('base64'),
        },
      }),
    ).toBeUndefined();
  });

  it('passes the unprefixed cancel message to HIP-820 and preserves the native SignatureMap', async () => {
    const message = 'Recharge cancel\nnetwork:hedera:testnet\npayer:0.0.7001';
    const signatureMap = Buffer.from(
      proto.SignatureMap.encode({
        sigPair: [
          {
            pubKeyPrefix: key.publicKey.toBytesRaw(),
            ed25519: key.sign(
              Buffer.from(`\x19Hedera Signed Message:\n${message.length}${message}`),
            ),
          },
        ],
      }).finish(),
    ).toString('base64');
    const request = vi.fn(async () => ({ signatureMap }));
    expect(await hashPackMessageSigner(session, request)(message)).toBe(signatureMap);
    expect(request).toHaveBeenCalledWith({
      topic: 't1',
      chainId: 'hedera:testnet',
      request: {
        method: 'hedera_signMessage',
        params: { signerAccountId: 'hedera:testnet:0.0.7001', message },
      },
    });
    await expect(
      hashPackMessageSigner(session, async () => ({ signatureMap: '' }))(message),
    ).rejects.toThrow('signatureMap');
    await expect(hashPackMessageSigner(session, request, () => false)(message)).rejects.toThrow(
      'ended',
    );
  });

  it('requires both native methods so a purchase session can authorize cancellation', () => {
    const sessionWith = (methods: string[]) => ({
      namespaces: { hedera: { accounts: ['hedera:testnet:0.0.7001'], methods, events: [] } },
    });
    expect(supportsNativeMethods(sessionWith(['hedera_signTransaction']))).toBe(false);
    expect(
      supportsNativeMethods(sessionWith(['hedera_signTransaction', 'hedera_signMessage'])),
    ).toBe(true);
  });
});
