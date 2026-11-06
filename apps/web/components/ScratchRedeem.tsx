'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PLAN_MB } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { CardPreview } from '@ethglobal/protocol/schemas';
import { Button, Coupon, ScratchCard } from '@ethglobal/ui/components';

import { PinField } from './PinField';
import { ProofPanel } from './ProofPanel';
import { AppHeader, Caution, Screen } from './Shell';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { dayLabel, formatMb } from '../lib/format';
import { buildProof, type Proof } from '../lib/proof';
import { hasPendingCardRedemption, redeemPin } from '../lib/redeem';

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
  // a failed redeem's proof; a served one travels to /plan with the issued facts (lib/redeem.ts)
  const [proof, setProof] = useState<Proof>();

  useEffect(() => {
    if (!serial) return;
    api.card(serial).then(setPreview, () => setPreview(null));
  }, [serial]);

  const mb = preview?.mb ?? PLAN_MB;
  const closed = preview && preview.state !== 'open';
  const recovery = preview?.state === 'claimed';
  const canEnter = !closed || recovery;

  const check = async () => {
    const digits = pin.replace(/\s+/g, '');
    if (!isValidPin(digits)) {
      setPinError(t('card.pinInvalid'));
      setChecked(undefined);
      return;
    }
    if (recovery && !(await hasPendingCardRedemption(digits))) {
      setPinError(t('card.noRecovery'));
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
    setProof(undefined);
    try {
      router.push(planHref(await redeemPin(checked, '/card/redeem')));
    } catch (e) {
      setStatus(t(errorKey(e instanceof ApiError ? e.code : 'network')));
      setProof(buildProof({ error: e }));
      setWorking(false);
    }
  };

  // No on-screen QR: it would encode the page you are on (RT design review #10); the printed card and the
  // gift's boarding pass carry it. No invented validity: the card preview has none (RT-W-09).
  const coupon = {
    mb,
    ...(preview?.sponsorName ? { sponsor: preview.sponsorName } : {}),
    ...(serial ? { serial } : {}),
    ...(preview ? { expires: t('card.claimBy', { day: dayLabel(preview.claimBy, lang) }) } : {}),
    lang,
  };

  return (
    <Screen wide className="card-screen">
      <AppHeader />
      <div className="card-layout">
        <div className="card-object">
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
            <Coupon
              {...coupon}
              {...(closed ? { status: t(`card.state.${preview.state}`) } : { sealed: true })}
            />
          )}
          {preview ? (
            <p
              className="card__state"
              data-testid="card-state"
              data-state={preview.state}
              lang={lang}
            >
              {formatMb(preview.mb)} · {t(`card.state.${preview.state}`)}
            </p>
          ) : null}
        </div>
        <section className="card-entry" aria-labelledby="card-title">
          <p className="eyebrow" lang={lang}>
            {t('hub.card')}
          </p>
          <h1 id="card-title" className="screen__title" lang={lang}>
            {t('card.heading')}
          </h1>
          <p className="flow-heading__intro" lang={lang}>
            {t(recovery ? 'card.recoverIntro' : 'card.intro')}
          </p>
          {closed ? (
            // a redeemed or expired card is not a dead end: the plan it became, or data to buy
            <p className="quiet-rows" lang={lang}>
              <Link href="/plan" prefetch={false}>
                {t('landing.open')}
              </Link>
              <Link href="/pay" prefetch={false}>
                {t('hub.buy')}
              </Link>
            </p>
          ) : null}
          {canEnter ? (
            <form
              className="pin-form"
              onSubmit={(e) => {
                e.preventDefault();
                void check();
              }}
            >
              <PinField
                label={t('card.pin')}
                value={pin}
                onChange={setPin}
                error={pinError}
                testId="card-pin"
              />
              <Button type="submit" variant="secondary">
                {t('card.check')}
              </Button>
            </form>
          ) : null}
          {canEnter ? <Caution k="warn.thisBrowser" /> : null}
          {checked && !revealed ? (
            <p className="note" lang={lang}>
              {t('card.scratch')}
            </p>
          ) : null}
          {checked ? (
            <Button
              block
              disabled={!revealed || working}
              onClick={() => void redeem()}
              data-testid="card-redeem"
            >
              {recovery ? t('card.recover') : t('card.redeem', { mb: formatMb(mb) })}
            </Button>
          ) : null}
          <p className="note" role="status" lang={lang}>
            {status ?? ' '}
          </p>
          <ProofPanel proof={proof} />
        </section>
      </div>
    </Screen>
  );
}
