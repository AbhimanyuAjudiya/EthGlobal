/** The perimeter strip every money screen carries (SCRIPTS.md §1 "Perimeter"); CSS px inside UiScreen. */
import { v } from '../theme';

export const TESTNET_STRIP = 'TESTNET · test USDC · not a sale';

export function TestnetStrip() {
  return (
    <div
      style={{
        background: v.sunken,
        borderBottom: `1px solid ${v.borderSubtle}`,
        padding: 12,
        fontSize: 12,
        lineHeight: 1.2,
        color: v.text,
        fontVariationSettings: "'wdth' 100, 'wght' 500",
      }}
    >
      {TESTNET_STRIP}
    </div>
  );
}
