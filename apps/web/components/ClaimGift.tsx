'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { GiftReclaimResponse } from '@ethglobal/protocol/schemas';
import { Button, Field, Hash, Receipt } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { dayLabel, formatMb, money } from '../lib/format';
import { useClock, useWallet } from '../lib/hooks';
import { claimGiftBySignature, reclaimGift, redeemPin } from '../lib/redeem';
import { isUserRejection } from '../lib/wallet';

import { sentGifts, type SentGift } from './GiftForm';
import { WalletButton } from './Shell';

const errText = (t: ReturnType<typeof useLang>['t'], e: unknown) =>
  t(errorKey(e instanceof ApiError ? e.code : 'network'));

/** `/gift/claim` — sign GiftClaim with the named wallet (no payment), or enter the PIN from the pass. */
export function ClaimGift({ giftId, name }: { giftId?: string; name?: string }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const { wallet, busy, error: walletError, pickInjected } = useWallet('recipient');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [working, setWorking] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setWorking(true);
    setStatus(undefined);
    try {
      router.push(planHref(await fn()));
    } catch (e) {
      if (!isUserRejection(e)) setStatus(errText(t, e));
      setWorking(false);
    }
  };

  return (
    <section className="sheet" aria-labelledby="claim-title">
      <h1 id="claim-title" className="sheet__title" lang={lang}>
        {t('gift.claimTitle')}
      </h1>
      {giftId && name ? (
        <>
          <WalletButton wallet={wallet} busy={busy} error={walletError} onInjected={() => void pickInjected()} />
          <p lang={lang}>{t('gift.claimSign')}</p>
          <Button
            block
            disabled={!wallet || working}
            onClick={() => wallet && void run(() => claimGiftBySignature(wallet, giftId as Hex, name))}
            data-testid="claim-by-signature"
          >
            {`${t('gift.claimButton')} · ${name}`}
          </Button>
        </>
      ) : null}
      <form
        className="pin-form"
        onSubmit={(e) => {
          e.preventDefault();
          const digits = pin.replace(/\s+/g, '');
          if (!isValidPin(digits)) return setPinError(t('card.pinInvalid'));
          setPinError(undefined);
          void run(() => redeemPin(digits, '/gift/claim'));
        }}
      >
        <Field
          label={t('gift.claimPin')}
          hint={t('card.pinHint')}
          mono
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          {...(pinError ? { error: pinError } : {})}
          data-testid="gift-pin"
        />
        <Button type="submit" variant="secondary" disabled={working}>
          {t('gift.claimButton')}
        </Button>
      </form>
      <p className="note" role="status" lang={lang}>
        {status ?? ' '}
      </p>
    </section>
  );
}

/** Reclaim (D-7): after claimBy the payer signs GiftReclaim and the treasury refunds the USDC. */
export function ReclaimGift({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t, lang } = useLang();
  const now = useClock(30_000);
  const { wallet } = useWallet('human');
  const [gifts, setGifts] = useState<SentGift[]>([]);
  const [done, setDone] = useState<Record<string, GiftReclaimResponse>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void sentGifts.list().then(setGifts);
  }, [refreshKey]);

  if (gifts.length === 0) return null;
  return (
    <section className="reclaim" aria-labelledby="reclaim-title" data-testid="reclaim">
      <h2 id="reclaim-title" lang={lang}>
        {t('gift.reclaimTitle')}
      </h2>
      <ul className="ledger-rows">
        {gifts.map((g) => {
          const refunded = done[g.giftId];
          const open = now >= g.claimBy;
          return (
            <li key={g.giftId} data-testid="reclaim-row">
              <span>
                {g.name} · {formatMb(g.mb)} · {dayLabel(g.claimBy)}
              </span>
              {refunded ? (
                <Receipt
                  heading={t('gift.reclaimed', { amount: money(refunded.refundedUsd6) })}
                  you={money(refunded.refundedUsd6)}
                  networkFee={money(refunded.feeUsd6)}
                />
              ) : (
                <Button
                  variant="secondary"
                  disabled={!wallet || !open}
                  onClick={() => {
                    if (!wallet) return;
                    reclaimGift(wallet, g.giftId as Hex).then(
                      (r) => setDone((d) => ({ ...d, [g.giftId]: r })),
                      (e: unknown) => setErrors((x) => ({ ...x, [g.giftId]: errText(t, e) })),
                    );
                  }}
                >
                  {open ? t('gift.reclaimButton') : t('gift.reclaimTooEarly')}
                </Button>
              )}
              {refunded ? <Hash value={refunded.tx} kind="refund transaction" /> : null}
              {errors[g.giftId] ? <span className="note">{errors[g.giftId]}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
