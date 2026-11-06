'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PLAN_MB } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { CardPreview } from '@ethglobal/protocol/schemas';
import { Coupon, ScratchCard } from '@ethglobal/ui/components';

import {
  ActionBar,
  Avatar,
  Button,
  Card,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  Skeleton,
  Ticket,
} from './kit';
import { PinField } from './PinField';
import { ProofPanel } from './ProofPanel';
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

  const stateTone = preview?.state === 'open' ? 'positive' : 'neutral';

  return (
    <>
      <PageHeader
        id="card-title"
        title={t('card.title')}
        lead={t(recovery ? 'card.recoverIntro' : 'card.lead')}
        lang={lang}
      />
      {serial && preview === undefined ? (
        <Skeleton shape="card" label="Loading the card" />
      ) : serial && preview === null ? (
        <Notice tone="warning" role="status" lang={lang}>
          {t('card.notFound')}
        </Notice>
      ) : serial || checked ? (
        <Ticket>
          {checked ? (
            <ScratchCard
              {...coupon}
              pin={checked}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
            />
          ) : (
            <Coupon
              {...coupon}
              {...(closed && preview
                ? { status: t(`card.state.${preview.state}`) }
                : { sealed: true })}
            />
          )}
        </Ticket>
      ) : null}
      {canEnter ? (
        <Card padded={false} lang={lang}>
          <form
            id="card-pin-form"
            className="card--padded"
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
            {checked ? (
              <Button type="submit" variant="secondary" block>
                {t('card.check')}
              </Button>
            ) : null}
          </form>
        </Card>
      ) : null}
      {preview ? (
        <ListGroup label={t('card.title')}>
          {serial ? <ListRow title={t('card.rowSerial')} value={serial} mono /> : null}
          <ListRow title={t('gift.size')} value={formatMb(preview.mb)} />
          {preview.sponsorName ? (
            <ListRow title={t('card.rowSponsor')} value={preview.sponsorName} />
          ) : null}
          <ListRow
            title={t('card.rowStatus')}
            subtitle={t('card.claimBy', { day: dayLabel(preview.claimBy, lang) })}
            trailing={
              <Pill
                tone={stateTone}
                data-testid="card-state"
                data-state={preview.state}
                lang={lang}
              >
                {formatMb(preview.mb)} · {t(`card.state.${preview.state}`)}
              </Pill>
            }
          />
        </ListGroup>
      ) : null}
      {closed ? (
        // a redeemed or expired card is not a dead end: the plan it became, or data to buy
        <ListGroup label={t('card.title')}>
          <ListRow leading={<Avatar icon="plan" />} title={t('landing.open')} href="/plan" />
          <ListRow leading={<Avatar icon="add" />} title={t('hub.buy')} href="/pay" />
        </ListGroup>
      ) : null}
      {checked && !revealed ? (
        <Notice tone="info" lang={lang}>
          {t('card.scratch')}
        </Notice>
      ) : null}
      {status ? (
        <Notice tone="negative" role="status" lang={lang}>
          {status}
        </Notice>
      ) : null}
      {canEnter ? (
        <Notice tone="warning" lang={lang}>
          {t('warn.thisBrowser')}
        </Notice>
      ) : null}
      <ProofPanel proof={proof} />
      {canEnter ? (
        <ActionBar>
          {checked ? (
            <Button
              block
              size="lg"
              disabled={!revealed || working}
              onClick={() => void redeem()}
              data-testid="card-redeem"
            >
              {recovery ? t('card.recover') : t('card.redeem', { mb: formatMb(mb) })}
            </Button>
          ) : (
            <Button type="submit" form="card-pin-form" block size="lg">
              {t('card.check')}
            </Button>
          )}
        </ActionBar>
      ) : null}
    </>
  );
}
