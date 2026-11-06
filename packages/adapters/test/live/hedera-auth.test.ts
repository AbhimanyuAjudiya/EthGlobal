import { createPrivateKey, sign as nodeSign } from 'node:crypto';

import { proto } from '@hiero-ledger/proto';
import { AccountId, Hbar, PrivateKey, TransactionId, TransferTransaction } from '@hiero-ledger/sdk';
import { ExactHederaScheme } from '@x402/hedera/exact/facilitator';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { hederaSessionMemo } from '@ethglobal/protocol/x402';

import {
  HederaAccountVerifier,
  hederaTransactionSessionBinding,
  inspectHederaPaymentTransaction,
} from '../../src/live/hedera-auth.js';

const ACCOUNT = '0.0.6006';
const FEE = '0.0.7162784';
const NONCE = `0x${'ab'.repeat(32)}` as const;
const MESSAGE = 'Recharge cancel plan\nNetwork: hedera:testnet\nNonce: 0123456789';
const key = PrivateKey.generateED25519();

async function transfer(memo = hederaSessionMemo(NONCE), nodes = ['0.0.3']) {
  const transaction = new TransferTransaction()
    .setTransactionId(TransactionId.fromString(`${FEE}@1793707200.123456789`))
    .setNodeAccountIds(nodes.map((node) => AccountId.fromString(node)))
    .setMaxTransactionFee(new Hbar(1))
    .setTransactionValidDuration(120)
    .setTransactionMemo(memo)
    .addTokenTransfer('0.0.429274', ACCOUNT, -1_000_000)
    .addTokenTransfer('0.0.429274', '0.0.5005', 1_000_000)
    .freeze();
  await transaction.sign(key);
  return Buffer.from(transaction.toBytes()).toString('base64');
}

function signatureMap(
  signature: Uint8Array,
  kind: 'ED25519' | 'ECDSA_SECP256K1',
  prefix: Uint8Array = new Uint8Array(),
) {
  return Buffer.from(
    proto.SignatureMap.encode({
      sigPair: [
        {
          pubKeyPrefix: prefix,
          ...(kind === 'ED25519' ? { ed25519: signature } : { ECDSASecp256k1: signature }),
        },
      ],
    }).finish(),
  ).toString('base64');
}
const accountResponse = (kind: string, publicKey: string) => ({
  account: ACCOUNT,
  deleted: false,
  key: { _type: kind, key: publicKey },
});

describe('native payment session binding', () => {
  it('reads the memo from the actual signed SDK transfer and identifies the debit payer separately from the fee payer', async () => {
    const encoded = await transfer();
    expect(hederaTransactionSessionBinding(encoded)).toBe(NONCE);
    expect(inspectHederaPaymentTransaction(encoded)).toEqual({
      transactionId: `${FEE}@1793707200.123456789`,
      payer: ACCOUNT,
      feePayer: FEE,
      validStart: '1793707200.123456789',
      validDurationS: 120,
      payTo: '0.0.5005',
      asset: '0.0.429274',
      amount: '1000000',
      memo: hederaSessionMemo(NONCE),
    });
    const requirements = {
      scheme: 'exact',
      network: 'hedera:testnet' as const,
      asset: '0.0.429274',
      amount: '1000000',
      payTo: '0.0.5005',
      maxTimeoutSeconds: 180,
      extra: { feePayer: FEE },
    };
    const facilitator = new ExactHederaScheme({
      getAddresses: () => [FEE],
      verifyPayerSignature: async ({ payer, transaction }) => ({
        ok:
          payer === ACCOUNT &&
          key.publicKey.verifyTransaction(
            TransferTransaction.fromBytes(Buffer.from(transaction, 'base64')),
          ),
      }),
      preflightTransfer: async () => ({ ok: true }),
      signAndSubmitTransaction: vi.fn(async () => {
        throw new Error('no submission permitted');
      }),
    });
    await expect(
      facilitator.verify(
        { x402Version: 2, accepted: requirements, payload: { transaction: encoded } },
        requirements,
      ),
    ).resolves.toMatchObject({ isValid: true, payer: ACCOUNT });
  });

  it('allows equivalent SDK node variants for top-ups but never for session-bound provision', async () => {
    const encoded = await transfer('', ['0.0.3', '0.0.4']);
    expect(inspectHederaPaymentTransaction(encoded)?.payer).toBe(ACCOUNT);
    expect(hederaTransactionSessionBinding(encoded)).toBeUndefined();
    const list = proto.TransactionList.decode(Buffer.from(encoded, 'base64'));
    const signed = proto.SignedTransaction.decode(list.transactionList[1]!.signedTransactionBytes!);
    const body = proto.TransactionBody.decode(signed.bodyBytes);
    body.memo = 'a different signed operation';
    signed.bodyBytes = proto.TransactionBody.encode(body).finish();
    list.transactionList[1]!.signedTransactionBytes =
      proto.SignedTransaction.encode(signed).finish();
    expect(
      inspectHederaPaymentTransaction(
        Buffer.from(proto.TransactionList.encode(list).finish()).toString('base64'),
      ),
    ).toBeUndefined();
  });

  it('rejects missing/alternate bindings, ambiguous envelopes, duplicate fields, and oversized bytes', async () => {
    for (const memo of ['', hederaSessionMemo(NONCE).toUpperCase(), `${hederaSessionMemo(NONCE)} `])
      expect(hederaTransactionSessionBinding(await transfer(memo))).toBeUndefined();
    const good = await transfer();
    for (const encoded of ['AAAA', `${good}\n`, 'A'.repeat(16_388)])
      expect(hederaTransactionSessionBinding(encoded)).toBeUndefined();
    const list = proto.TransactionList.decode(Buffer.from(good, 'base64'));
    list.transactionList.push(list.transactionList[0]!);
    expect(
      hederaTransactionSessionBinding(
        Buffer.from(proto.TransactionList.encode(list).finish()).toString('base64'),
      ),
    ).toBeUndefined();
    list.transactionList.pop();
    list.transactionList[0]!.bodyBytes = new Uint8Array([1]);
    expect(
      hederaTransactionSessionBinding(
        Buffer.from(proto.TransactionList.encode(list).finish()).toString('base64'),
      ),
    ).toBeUndefined();
  });
});

describe('HIP-820 native account ownership', () => {
  it('accepts an independent Node Ed25519 signature with the HIP-820 prefix, never a bare signature', async () => {
    const seed = Buffer.alloc(32, 7); // local test key only, no funded account
    const privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const sdkKey = PrivateKey.fromBytesED25519(seed);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(accountResponse('ED25519', sdkKey.publicKey.toStringRaw())),
    );
    const verifier = new HederaAccountVerifier({ fetch: fetcher });
    const messageBytes = Buffer.from(`\x19Hedera Signed Message:\n${MESSAGE.length}${MESSAGE}`);
    const proof = signatureMap(nodeSign(null, messageBytes, privateKey), 'ED25519');
    const input = {
      network: 'hedera:testnet',
      accountId: ACCOUNT,
      message: MESSAGE,
      signatureMap: proof,
    };
    await expect(verifier.verifyMessage(input)).resolves.toBe(true);
    await expect(verifier.verifyMessage({ ...input, message: `${MESSAGE} altered` })).resolves.toBe(
      false,
    );
    await expect(
      verifier.verifyMessage({
        ...input,
        signatureMap: signatureMap(nodeSign(null, Buffer.from(MESSAGE), privateKey), 'ED25519'),
      }),
    ).resolves.toBe(false);
    expect(fetcher.mock.calls[0]![0]).toBe(
      `https://testnet.mirrornode.hedera.com/api/v1/accounts/${ACCOUNT}`,
    );
  });

  it('accepts independent viem secp256k1 signing of the HIP-820 keccak digest, including a full key prefix', async () => {
    const seed = `0x${'18'.repeat(32)}` as const; // local test key only
    const account = privateKeyToAccount(seed);
    const publicKey = PrivateKey.fromStringECDSA(seed.slice(2)).publicKey;
    const messageBytes = Buffer.from(`\x19Hedera Signed Message:\n${MESSAGE.length}${MESSAGE}`);
    const signed = await account.sign({ hash: keccak256(messageBytes) });
    const verifier = new HederaAccountVerifier({
      fetch: async () => Response.json(accountResponse('ECDSA_SECP256K1', publicKey.toStringRaw())),
    });
    await expect(
      verifier.verifyMessage({
        network: 'hedera:mainnet',
        accountId: ACCOUNT,
        message: MESSAGE,
        signatureMap: signatureMap(
          toBytes(signed).subarray(0, 64),
          'ECDSA_SECP256K1',
          publicKey.toBytesRaw(),
        ),
      }),
    ).resolves.toBe(true);
  });

  it('never trusts a supplied public key, unknown/threshold keys, deleted accounts, or another account/network', async () => {
    const signature = key.sign(
      Buffer.from(`\x19Hedera Signed Message:\n${MESSAGE.length}${MESSAGE}`),
    );
    const proof = signatureMap(signature, 'ED25519', key.publicKey.toBytesRaw());
    const other = PrivateKey.generateED25519();
    const input = {
      network: 'hedera:testnet',
      accountId: ACCOUNT,
      message: MESSAGE,
      signatureMap: proof,
    };
    for (const response of [
      accountResponse('ED25519', other.publicKey.toStringRaw()),
      accountResponse('ProtobufEncoded', '00'),
      { ...accountResponse('ED25519', key.publicKey.toStringRaw()), deleted: true },
      { ...accountResponse('ED25519', key.publicKey.toStringRaw()), account: '0.0.9999' },
    ])
      await expect(
        new HederaAccountVerifier({ fetch: async () => Response.json(response) }).verifyMessage(
          input,
        ),
      ).resolves.toBe(false);
    const fetcher = vi.fn(async () =>
      Response.json(accountResponse('ED25519', key.publicKey.toStringRaw())),
    );
    const verifier = new HederaAccountVerifier({ fetch: fetcher });
    for (const over of [
      { network: 'eip155:296' },
      { accountId: '0.0.06006' },
      { signatureMap: 'AAAA' },
      { signatureMap: 'A'.repeat(8_196) },
      { message: 'non-ASCII é' },
    ])
      await expect(verifier.verifyMessage({ ...input, ...over })).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats mirror outages as unavailable without leaking the response, and nonexistent accounts as invalid', async () => {
    const input = {
      network: 'hedera:testnet',
      accountId: ACCOUNT,
      message: MESSAGE,
      signatureMap: signatureMap(
        key.sign(Buffer.from(`\x19Hedera Signed Message:\n${MESSAGE.length}${MESSAGE}`)),
        'ED25519',
      ),
    };
    const verifier = new HederaAccountVerifier({
      fetch: async () => Response.json({ secret: 'do-not-log' }, { status: 503 }),
    });
    await expect(verifier.verifyMessage(input)).rejects.toMatchObject({
      adapter: 'nativeAccounts',
      code: 'unavailable',
      message: 'Native account verification unavailable',
    });
    await expect(
      new HederaAccountVerifier({
        fetch: async () => new Response('', { status: 404 }),
      }).verifyMessage(input),
    ).resolves.toBe(false);
    expect(
      () =>
        new HederaAccountVerifier({
          mirrorUrls: { 'hedera:testnet': 'https://mainnet-public.mirrornode.hedera.com' },
        }),
    ).toThrow('another network');
  });
});
