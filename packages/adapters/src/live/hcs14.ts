/**
 * HCS-14 self-issued UAID (A-29; API-FACTS §2.7; standards-sdk@0.1.192 src/hcs-14):
 * id = base58(sha384(JSON.stringify({ skills, name, nativeId, protocol, registry, version }))) — that key order,
 * strings trimmed, protocol/registry lower-cased, skills sorted integers. The routing parameters are emitted in the
 * order the reference createUaid emits them: uid, registry, proto, nativeId.
 */
import { sha384 } from '@ethglobal/crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Bitcoin-alphabet base58 (leading zero bytes become leading '1's). */
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)]! + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export interface Hcs14Input {
  registry: 'hedera';
  name: string;
  version: string;
  protocol: 'x402';
  /** CAIP-10, e.g. hedera:testnet:0.0.6006 */
  nativeId: string;
  skills?: number[];
}

export function hcs14Uaid(input: Hcs14Input): string {
  const skills = [...(input.skills ?? [])];
  if (!skills.every((s) => Number.isSafeInteger(s) && s >= 0))
    throw new Error('skills must be non-negative integers');
  if (!/^hedera:(testnet|mainnet|previewnet):0\.0\.\d{1,12}$/.test(input.nativeId.trim())) {
    throw new Error('nativeId must be CAIP-10 hedera:<network>:0.0.x');
  }
  const canonical = {
    skills: skills.sort((a, b) => a - b),
    name: input.name.trim(),
    nativeId: input.nativeId.trim(),
    protocol: input.protocol.trim().toLowerCase(),
    registry: input.registry.trim().toLowerCase(),
    version: input.version.trim(),
  };
  if (!canonical.name || !canonical.version) throw new Error('name and version are required');
  const id = base58(sha384(new TextEncoder().encode(JSON.stringify(canonical))));
  return `uaid:aid:${id};uid=0;registry=${canonical.registry};proto=${canonical.protocol};nativeId=${canonical.nativeId}`;
}
