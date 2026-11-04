'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { isValidPin } from '@ethglobal/protocol/pin';
import type { CardPreview } from '@ethglobal/protocol/schemas';
import { Button, Coupon, Field, ScratchCard } from '@ethglobal/ui/components';

import { renderQr } from './QrCode';
import { AppHeader, Screen } from './Shell';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { dayLabel, formatMb } from '../lib/format';
import { redeemPin } from '../lib/redeem';


/**
 * `/card/[serial]` (and `/card`): preview (GET is read-only, T-47) → type the PIN from under the latex →
 * Verhoeff check on the device → scratch (or "Reveal PIN") → Redeem. The page never knows the PIN until typed
 * and never redeems on load.
 */
export function ScratchRedeem({ serial }: { serial?: string }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [preview, setPreview] = useState<CardPreview | null | undefined>(serial ? undefined : null);
  const [pin, setPin] = useState('');
  const [checked, setChecked] = useState<string | undefined>();
  const [pinError, setPinError] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    if (!serial) return;
    api.card(serial).then(setPreview, () => setPreview(null));
  }, [serial]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const mb = preview?.mb ?? 300;
  const closed = preview && preview.state !== 'open';

  const check = () => {
    const digits = pin.replace(/\s+/g, '');
    if (!isValidPin(digits)) {
      setPinError(t('card.pinInvalid'));
      setChecked(undefined);
      return;
    }
    setPinError(undefined);
    setChecked(digits);
    setRevealed(false);
  };

  const redeem = async () => {
    if (!checked) return;
    setWorking(true);
    setStatus(undefined);
    try {
      router.push(planHref(await redeemPin(checked, '/card/redeem')));
    } catch (e) {
      setStatus(t(errorKey(e instanceof ApiError ? e.code : 'network')));
      setWorking(false);
    }
  };

  const coupon = {
    mb,
    ...(preview?.sponsorName ? { sponsor: preview.sponsorName } : {}),
    ...(serial ? { serial, qrUrl: `${origin}/card/${serial}`, renderQr } : {}),
    ...(preview ? { expires: `Claim by ${dayLabel(preview.claimBy)}` } : {}),
    validity: 'Mumbai · 7 days',
    lang: lang === 'hi' ? ('hi' as const) : ('en' as const),
  };

  return (
    <Screen>
      <AppHeader />
      {serial && preview === undefined ? (
        <div className="skeleton skeleton--coupon" aria-label="Loading the card" />
      ) : serial && preview === null ? (
        <p className="note" role="status" lang={lang}>
          {t('card.notFound')}
        </p>
      ) : checked ? (
        <ScratchCard
          {...coupon}
          pin={checked}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
        />
      ) : (
        <Coupon {...coupon} {...(closed ? { status: t(`card.state.${preview.state}`) } : {})} />
      )}
      {preview ? (
        <p className="card__state" data-testid="card-state" data-state={preview.state} lang={lang}>
          {formatMb(preview.mb)} · {t(`card.state.${preview.state}`)}
        </p>
      ) : null}
      {!closed ? (
        <form
          className="pin-form"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <Field
            label={t('card.pin')}
            hint={t('card.pinHint')}
            mono
            inputMode="numeric"
            autoComplete="off"
            maxLength={19}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            {...(pinError ? { error: pinError } : {})}
            data-testid="card-pin"
          />
          <Button type="submit" variant="secondary">
            {t('card.check')}
          </Button>
        </form>
      ) : null}
      {checked && !revealed ? (
        <p className="note" lang={lang}>
          {t('card.scratch')}
        </p>
      ) : null}
      {checked ? (
        <Button block disabled={!revealed || working} onClick={() => void redeem()} data-testid="card-redeem">
          {t('card.redeem', { mb: formatMb(mb) })}
        </Button>
      ) : null}
      <p className="note" role="status" lang={lang}>
        {status ?? ' '}
      </p>
    </Screen>
  );
}
