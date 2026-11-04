/** EIP-712 domains of EIP-3009 tokens. The name is data per deployment, never a literal (A-21). */
import { getAddress, isAddress, type Address, type PublicClient, type TypedDataDomain } from 'viem';

import { TOKEN_READ_ABI } from './abi.js';
import { Eip3009Error } from './errors.js';

const EIP155 = /^eip155:([1-9]\d{0,15})$/;

const bad = (message: string): Eip3009Error => new Eip3009Error('invalid_domain', message);

/** The FiatTokenV2_2 domain `(name, version, chainId, verifyingContract)`. Base Sepolia USDC = ("USDC","2"). */
export function domain(
  token: Address,
  chainId: number,
  name: string,
  version: string,
): TypedDataDomain {
  if (!isAddress(token, { strict: false })) throw bad(`not an address: ${String(token)}`);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw bad(`bad chainId ${chainId}`);
  if (name === '' || version === '') throw bad('name and version must be non-empty');
  return { name, version, chainId, verifyingContract: getAddress(token) };
}

/**
 * The one builder the exact-EVM signers and verifiers use: name/version from `extra` (what the API advertised),
 * chainId from the eip155 reference, verifyingContract = asset. Throws on a missing or non-string name/version.
 */
export function domainFromRequirements(req: {
  network: string;
  asset: string;
  extra?: Record<string, unknown> | undefined;
}): TypedDataDomain {
  const match = EIP155.exec(req.network);
  if (!match?.[1]) throw bad(`not an eip155 network: ${req.network}`);
  const name = req.extra?.name;
  const version = req.extra?.version;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw bad('requirements.extra must carry the token EIP-712 name and version');
  }
  return domain(req.asset as Address, Number(match[1]), name, version);
}

/**
 * The token's own view of its domain: ERC-5267 `eip712Domain()`, falling back to `name()`/`version()` and the
 * client's chain id for tokens without it. Callers cache per token (the facilitator does).
 */
export async function readDomain(
  publicClient: PublicClient,
  token: Address,
): Promise<{ name: string; version: string; chainId: number }> {
  try {
    const [, name, version, chainId] = await publicClient.readContract({
      address: token,
      abi: TOKEN_READ_ABI,
      functionName: 'eip712Domain',
    });
    return { name, version, chainId: Number(chainId) };
  } catch {
    const [name, version, chainId] = await Promise.all([
      publicClient.readContract({ address: token, abi: TOKEN_READ_ABI, functionName: 'name' }),
      publicClient.readContract({ address: token, abi: TOKEN_READ_ABI, functionName: 'version' }),
      publicClient.getChainId(),
    ]);
    return { name, version, chainId };
  }
}
