/**
 * The `Coupon` in its screen variant (DECISION §8.2; SCRIPTS.md §3 "Rendered shots"): warm paper, the hero MB
 * in oxide teal (the frame's one accent), the bilingual line, a silver latex panel, QR, serial, expiry.
 * Two still states only — `sealed` and `revealed`. There is deliberately no rendered scratch: the real
 * scratch is filmed (SCRIPTS.md §3). Stays paper-light in dark mode on purpose.
 */
import { type CouponSeed } from '../seed';
import { v } from '../theme';
import { Qr } from './Qr';

export function CouponScreen({
  coupon,
  state,
  lang = 'en',
}: {
  coupon: CouponSeed;
  state: 'sealed' | 'revealed';
  /** `hi` sets the latex instruction in Devanagari only (SCRIPTS.md §3 S3). */
  lang?: 'en' | 'hi';
}) {
  return (
    <div
      style={{
        colorScheme: 'light',
        background: v.surface,
        color: v.text,
        border: `1px solid ${v.borderSubtle}`,
        borderRadius: 6,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 16, fontVariationSettings: "'wdth' 110, 'wght' 700" }}>Recharge</div>
      <div
        className="num"
        style={{
          fontSize: 64,
          lineHeight: 1,
          color: v.accent,
          fontVariationSettings: "'wdth' 110, 'wght' 700",
        }}
      >
        {coupon.mb} MB
      </div>
      <div style={{ fontSize: 16 }}>
        {coupon.city} · {coupon.days} days
      </div>
      <div style={{ fontSize: 14 }}>
        because you&rsquo;re human
        <br />
        <span lang="hi" style={{ lineHeight: 1.6 }}>
          क्योंकि आप इंसान हैं
        </span>
      </div>
      {/* 34 × 12 mm latex panel → 2.83 : 1. Silver latex = the warm decorative grey token. */}
      <div
        style={{
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: state === 'sealed' ? v.borderStrong : v.sunken,
          border: `1px solid ${v.borderSubtle}`,
          borderRadius: 4,
        }}
      >
        {state === 'sealed' ? (
          <span
            lang={lang === 'hi' ? 'hi' : undefined}
            style={{
              fontFamily: "'Baloo 2'",
              fontVariationSettings: 'normal',
              fontWeight: 700,
              fontSize: 16,
              color: v.textSecondary,
            }}
          >
            {lang === 'hi' ? 'यहाँ रगड़ें' : 'rub here · यहाँ रगड़ें'}
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 22, letterSpacing: '0.04em' }}>
            {coupon.pinGroups.join(' ')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="mono" style={{ fontSize: 11, color: v.textSecondary }}>
            {coupon.serial}
          </span>
          <span style={{ fontSize: 12 }}>{coupon.expires}</span>
        </div>
        <Qr data={coupon.cardUrl} size={78} />
      </div>
    </div>
  );
}
