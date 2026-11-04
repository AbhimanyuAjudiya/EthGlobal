/**
 * Pure helpers of the print run (scripts/print-cards.ts), importable by tests without starting anything.
 */
import { rechargeDomain, SPONSOR_CARDS_TYPES } from '@ethglobal/protocol/typed-data';

/** The EIP-712 JSON `cast wallet sign --data` expects (EIP712Domain spelled out, uint256 as decimal strings). */
export function sponsorCardsTypedData(m: {
  chainId: number;
  campaignId: string;
  sponsor: string;
  count: number;
  mb: number;
  nonce: string;
  issuedAt: number;
}) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ...SPONSOR_CARDS_TYPES,
    },
    primaryType: 'SponsorCards' as const,
    domain: rechargeDomain(m.chainId),
    message: {
      campaignId: m.campaignId,
      sponsor: m.sponsor,
      count: String(m.count),
      mb: String(m.mb),
      nonce: m.nonce,
      issuedAt: String(m.issuedAt),
    },
  };
}
