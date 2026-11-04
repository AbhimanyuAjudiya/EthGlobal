import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { z } from 'zod';

import {
  HEDERA_MAX_TIMEOUT_S,
  NETWORKS,
  PAYMENT_VALIDITY_S,
  USDC_ASSET,
  USDC_EIP712_DOMAIN,
  isEvmNetwork,
  isHederaNetwork,
} from '@ethglobal/protocol/ids';
import { acceptTemplateSchema, type AcceptTemplate } from '@ethglobal/protocol/schemas';

import type { Env } from './env.js';

/** `deploy/addresses.<slug>.json` (INTERFACES §6.3), read at boot because Anvil's is regenerated per deploy. */
export const addressesSchema = z.object({
  chainId: z.int(),
  network: z.string(),
  dataDrop: z.string(),
  usdc: z.string(),
  payout: z.string(),
  attestor: z.string(),
});
export type DeployAddresses = z.infer<typeof addressesSchema>;

export function loadAddresses(slug: string): DeployAddresses | undefined {
  try {
    const path = createRequire(import.meta.url).resolve(
      `@ethglobal/contracts/addresses/${slug}.json`,
    );
    return addressesSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export interface AcceptInputs {
  env: Pick<
    Env,
    'X402_NETWORKS' | 'PAYOUT_ADDRESS' | 'PAYOUT_HEDERA_ACCOUNT' | 'X402_HEDERA_FEE_PAYER'
  >;
  /** MockUSDC3009 on Anvil (USDC_ADDRESS or addresses.anvil.json). */
  anvilUsdc?: string | undefined;
  /** The Hedera facilitator's fee payer from its /supported (A-20). */
  hederaFeePayer?: string | undefined;
}

/**
 * accepts[] templates, built once at boot (brief §4.6b): EVM `extra` = the token's EIP-712 domain from
 * USDC_EIP712_DOMAIN (a network without one refuses to boot); Hedera `extra.feePayer` from the facilitator, pinned by
 * X402_HEDERA_FEE_PAYER when set, `maxTimeoutSeconds` 180. Every template is validated before the server listens.
 */
export function buildAcceptTemplates(inputs: AcceptInputs): AcceptTemplate[] {
  return inputs.env.X402_NETWORKS.map((network) => {
    const template = isEvmNetwork(network)
      ? evmTemplate(network, inputs)
      : hederaTemplate(network, inputs);
    const parsed = acceptTemplateSchema.safeParse(template);
    if (!parsed.success)
      throw new Error(`accepts: invalid template for ${network}: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  });
}

function evmTemplate(network: string, { env, anvilUsdc }: AcceptInputs): AcceptTemplate {
  const domain = USDC_EIP712_DOMAIN[network];
  if (!domain) throw new Error(`accepts: no USDC EIP-712 domain for ${network} (A-21)`);
  const asset =
    network === NETWORKS.anvil ? anvilUsdc : (USDC_ASSET as Record<string, string>)[network];
  if (asset === undefined) throw new Error(`accepts: no USDC asset for ${network}`);
  return {
    scheme: 'exact',
    network,
    asset,
    payTo: env.PAYOUT_ADDRESS,
    maxTimeoutSeconds: PAYMENT_VALIDITY_S,
    extra: { name: domain.name, version: domain.version },
  };
}

function hederaTemplate(network: string, { env, hederaFeePayer }: AcceptInputs): AcceptTemplate {
  if (!isHederaNetwork(network)) throw new Error(`accepts: unsupported network ${network}`);
  if (env.PAYOUT_HEDERA_ACCOUNT === undefined)
    throw new Error('accepts: PAYOUT_HEDERA_ACCOUNT is required for hedera:*');
  if (hederaFeePayer === undefined)
    throw new Error('accepts: the Hedera facilitator advertised no feePayer (A-20)');
  if (env.X402_HEDERA_FEE_PAYER !== undefined && env.X402_HEDERA_FEE_PAYER !== hederaFeePayer) {
    throw new Error(
      `accepts: facilitator fee payer ${hederaFeePayer} ≠ pinned X402_HEDERA_FEE_PAYER`,
    );
  }
  return {
    scheme: 'exact',
    network,
    asset: USDC_ASSET[NETWORKS.hederaTestnet],
    payTo: env.PAYOUT_HEDERA_ACCOUNT,
    maxTimeoutSeconds: HEDERA_MAX_TIMEOUT_S,
    extra: { feePayer: hederaFeePayer },
  };
}
