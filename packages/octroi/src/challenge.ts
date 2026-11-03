/**
 * MAC-bound challenges (INTERFACES §5, A-3; T-20, T-21, T-32, T-45). Issuing writes nothing; the MAC makes a
 * nonce unforgeable without the secret and binds audience, path, expiry and the session key.
 */
import type { Ledger } from '@ethglobal/adapters';
import {
  bytesToHex,
  concat,
  hexToBytes,
  hmacSha256,
  keccak256,
  randomBytes,
  timingSafeEqual,
  utf8,
} from '@ethglobal/crypto';
import {
  CHALLENGE_PATHS,
  CHALLENGE_TTL_S,
  type ChallengePath,
  type Hex,
} from '@ethglobal/protocol/ids';

import { assertSecret, hex32Bytes } from './keys.js';
import { NonceStore } from './store/nonce.js';

export interface Challenge {
  nonce: Hex;
  audience: string;
  path: ChallengePath;
  exp: number;
  signal: Hex;
}

export type ConsumeResult = 'ok' | 'replayed' | 'expired' | 'invalid' | 'unavailable';

const RANDOM_BYTES = 16;
const TAG_BYTES = 16;
const TTL_MS = CHALLENGE_TTL_S * 1000;
/** A challenge may claim at most TTL + 5 s of remaining life (clock-skew guard). */
const MAX_REMAINING_MS = TTL_MS + 5_000;
const NONCE_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_FIELD_BYTES = 255;

/**
 * Length-prefixed field: `len(u8) ‖ utf8(s)`. The brief's plain concatenation would let
 * ('recharge/gift', '/claim') and ('recharge', '/gift/claim') share a MAC; the prefix removes that ambiguity.
 */
function field(s: string): Uint8Array {
  const bytes = utf8(s);
  if (bytes.length > MAX_FIELD_BYTES) throw new RangeError('challenge field too long');
  return concat(Uint8Array.of(bytes.length), bytes);
}

function uint64be(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
}

function tagFor(
  secret: Uint8Array,
  random: Uint8Array,
  audience: string,
  path: string,
  exp: number,
  sessionPubKey: Hex,
): Uint8Array {
  return hmacSha256(
    secret,
    random,
    field(audience),
    field(path),
    uint64be(exp),
    hex32Bytes(sessionPubKey, 'sessionPubKey'),
  ).slice(0, TAG_BYTES);
}

/** keccak256(nonce bytes ‖ utf8(audience)): the IDKit signal (T-19). */
export function signalFor(nonce: Hex, audience: string): Hex {
  return keccak256(concat(hexToBytes(nonce), utf8(audience)));
}

/** nonce = random16 ‖ HMAC(secret, random16 ‖ audience ‖ path ‖ exp ‖ sessionPubKey)[0..16]. */
export function challenge(
  audience: string,
  path: ChallengePath,
  sessionPubKey: Hex,
  now: number,
  secret: Uint8Array,
): Challenge {
  assertSecret(secret);
  const exp = now + TTL_MS;
  const random = randomBytes(RANDOM_BYTES);
  const nonce = bytesToHex(
    concat(random, tagFor(secret, random, audience, path, exp, sessionPubKey)),
  );
  return { nonce, audience, path, exp, signal: signalFor(nonce, audience) };
}

/** The pure part: MAC, session key, path, signal, expiry. Never throws. */
function checkMac(
  c: Challenge,
  sessionPubKey: Hex,
  now: number,
  secret: Uint8Array,
): ConsumeResult {
  try {
    if (!NONCE_PATTERN.test(c.nonce) || !CHALLENGE_PATHS.includes(c.path)) return 'invalid';
    if (!Number.isSafeInteger(c.exp) || c.exp < 0) return 'invalid';
    const bytes = hexToBytes(c.nonce);
    const random = bytes.slice(0, RANDOM_BYTES);
    const expected = tagFor(secret, random, c.audience, c.path, c.exp, sessionPubKey);
    if (!timingSafeEqual(bytes.slice(RANDOM_BYTES), expected)) return 'invalid';
    if (c.signal.toLowerCase() !== signalFor(c.nonce, c.audience)) return 'invalid';
  } catch {
    return 'invalid';
  }
  if (now > c.exp) return 'expired';
  if (c.exp - now > MAX_REMAINING_MS) return 'invalid';
  return 'ok';
}

/**
 * MAC + session key + exp, then the in-memory set SYNCHRONOUSLY before any await (T-20 concurrent
 * double-consume), then the ledger; the nonce entity is written before 'ok'. On a ledger failure the nonce
 * stays in the cache and the result is 'unavailable' ⇒ the caller denies (fail closed).
 */
export async function consumeChallenge(
  ledger: Ledger,
  cache: Set<string>,
  c: Challenge,
  sessionPubKey: Hex,
  now: number,
  secret: Uint8Array,
): Promise<ConsumeResult> {
  assertSecret(secret);
  const verdict = checkMac(c, sessionPubKey, now, secret);
  if (verdict !== 'ok') return verdict;
  const id = c.nonce.toLowerCase();
  if (cache.has(id)) return 'replayed';
  cache.add(id);
  const store = new NonceStore(ledger, () => now);
  try {
    if (await store.consumed(c.nonce)) return 'replayed';
    await store.consume(c, now);
  } catch {
    return 'unavailable';
  }
  return 'ok';
}
