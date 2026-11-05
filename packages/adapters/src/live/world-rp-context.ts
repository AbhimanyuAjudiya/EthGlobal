/**
 * createRpContextSigner (A-25, T-81): the backend-signed `rp_context` IDKit 4 requires. The message is built by
 * `computeRpSignatureMessage` from @worldcoin/idkit-core/signing (0x01 ‖ nonce ‖ created_at u64 BE ‖
 * expires_at u64 BE ‖ hash_to_field(action), EIP-191) — the same function idkit's `signRequest` uses — but with
 * the injected clock (signRequest reads Date.now and takes no clock) and our CSPRNG nonce. The key never leaves
 * this closure: not in the result, not in errors, not in logs.
 */
import { computeRpSignatureMessage } from '@worldcoin/idkit-core/signing';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { hashToField, randomBytes } from '@ethglobal/crypto';
import { rpContextSchema, type RpContext } from '@ethglobal/protocol/schemas';

import { Secret } from './secret.js';

export const RP_CONTEXT_TTL_S = 300;

export interface RpContextSignerOptions {
  appId: string;
  rpId: string;
  action: string;
  environment: 'production' | 'staging';
  signingKeyHex: Hex | Secret<Hex>;
  /** Default 300 s; never more (T-81 c). */
  ttlS?: number;
  now: () => number;
  /** 32 random bytes; injectable only so the vector test is deterministic. */
  entropy?: () => Uint8Array;
}

export function createRpContextSigner(opts: RpContextSignerOptions): {
  issue(): Promise<RpContext>;
} {
  const ttl = opts.ttlS ?? RP_CONTEXT_TTL_S;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > RP_CONTEXT_TTL_S) {
    throw new Error(`rp_context ttl must be 1..${RP_CONTEXT_TTL_S} s`);
  }
  const key =
    opts.signingKeyHex instanceof Secret ? opts.signingKeyHex : new Secret(opts.signingKeyHex);
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount(key.reveal());
  } catch {
    throw new Error('WORLD_RP_SIGNING_KEY is not a 32-byte hex key');
  }
  const entropy = opts.entropy ?? (() => randomBytes(32));
  return {
    async issue() {
      // nonce = hash_to_field(32 random bytes), as idkit-server's signRequest derives it
      const nonce = hashToField(entropy());
      const createdAt = Math.floor(opts.now() / 1000);
      const expiresAt = createdAt + ttl;
      const message = computeRpSignatureMessage(
        hexToBytes(nonce),
        createdAt,
        expiresAt,
        opts.action,
      );
      const signature = await account.signMessage({ message: { raw: message } });
      return rpContextSchema.parse({
        rp_id: opts.rpId,
        nonce,
        created_at: createdAt,
        expires_at: expiresAt,
        signature,
        app_id: opts.appId,
        action: opts.action,
        environment: opts.environment,
      });
    },
  };
}

/** The signer address of an rp_context, recomputed from the documented algorithm (tests, and the API's self-check). */
export async function rpContextSigner(ctx: RpContext): Promise<Hex> {
  const { recoverMessageAddress } = await import('viem');
  const message = computeRpSignatureMessage(
    hexToBytes(ctx.nonce as Hex),
    ctx.created_at,
    ctx.expires_at,
    ctx.action,
  );
  return recoverMessageAddress({
    message: { raw: bytesToHex(message) },
    signature: ctx.signature as Hex,
  });
}
