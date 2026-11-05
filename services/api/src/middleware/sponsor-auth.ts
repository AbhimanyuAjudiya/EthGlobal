import { z } from 'zod';

import { SPONSOR_AUTH_SCHEME } from '@ethglobal/protocol/events';
import type { Hex } from '@ethglobal/protocol/ids';
import { evmAddressSchema, hexSchema, msSchema } from '@ethglobal/protocol/schemas';
import {
  rechargeDomain,
  SPONSOR_LOGIN_TTL_MS,
  SPONSOR_LOGIN_TYPES,
} from '@ethglobal/protocol/typed-data';

import { fail } from '../errors.js';
import { signedBy } from '../signatures.js';

import type { Deps } from '../deps.js';
import type { Address } from 'viem';

/** A signed SponsorLogin may be up to 1 h old and at most 60 s in the future (T-72). */
export const SPONSOR_FUTURE_SKEW_MS = 60_000;

const bearerSchema = z.object({
  sponsor: evmAddressSchema,
  issuedAt: msSchema,
  signature: hexSchema,
});

/** EIP-712 `SponsorLogin{campaignId, sponsor, issuedAt}` over rechargeDomain(CHAIN); 401 on any mismatch. */
export async function verifySponsorLogin(
  deps: Pick<Deps, 'chainId' | 'now'>,
  login: { campaignId: Hex; sponsor: string; issuedAt: number; signature: string },
): Promise<Address> {
  const now = deps.now();
  if (
    login.issuedAt < now - SPONSOR_LOGIN_TTL_MS ||
    login.issuedAt > now + SPONSOR_FUTURE_SKEW_MS
  ) {
    throw fail('unauthorized', { detail: 'issuedAt outside the login window' });
  }
  const ok = await signedBy({
    address: login.sponsor as Address,
    domain: rechargeDomain(deps.chainId),
    types: SPONSOR_LOGIN_TYPES,
    primaryType: 'SponsorLogin',
    message: {
      campaignId: login.campaignId,
      sponsor: login.sponsor as Address,
      issuedAt: BigInt(login.issuedAt),
    },
    signature: login.signature as Hex,
  });
  if (!ok) throw fail('unauthorized', { detail: 'bad SponsorLogin signature' });
  return login.sponsor as Address;
}

/** `Authorization: Recharge-Sponsor <base64 JSON {sponsor, issuedAt, signature}>` → the verified sponsor. */
export async function sponsorFromHeader(
  deps: Pick<Deps, 'chainId' | 'now'>,
  header: string | undefined,
  campaignId: Hex,
): Promise<Address> {
  const prefix = `${SPONSOR_AUTH_SCHEME} `;
  if (header?.startsWith(prefix) !== true || header.length > 2048)
    throw fail('unauthorized', { detail: 'missing sponsor authorization' });
  let bearer: z.infer<typeof bearerSchema>;
  try {
    bearer = bearerSchema.parse(
      JSON.parse(Buffer.from(header.slice(prefix.length), 'base64').toString('utf8')),
    );
  } catch {
    throw fail('unauthorized', { detail: 'malformed sponsor authorization' });
  }
  return verifySponsorLogin(deps, { campaignId, ...bearer });
}
