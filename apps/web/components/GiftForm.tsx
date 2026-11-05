'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { GIFT_RECLAIM_WINDOW_S } from '@ethglobal/protocol/ids';
import type { GiftResponse } from '@ethglobal/protocol/schemas';
import { BoardingPass, Button, Field, Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { renderQr } from './QrCode';
import { saveCardPng } from './save-card';
import { useWalletLabel, WalletButton } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { dayLabel, formatMb, money, moneyUsdc, priceFor } from '../lib/format';
import { usePlans, useWallet } from '../lib/hooks';
import {
  DemoWalletSigner,
  EvmWalletSigner,
  pay,
  paymentFailureReason,
  quote,
  signingFailure,
} from '../lib/pay402';
import { get, set } from '../lib/store';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { chainNow } from '../lib/wallet';

const SIZES_MB = [300, 1000, 3000];
type Resolution = 'idle' | 'resolving' | 'resolves' | 'unresolved' | 'error';

export interface SentGift {
  giftId: string;
  serial: string;
  name: string;
  to: string;
  mb: number;
  claimBy: number;
  payer: string;
  usd6: string;
}

export const sentGifts = {
  list: async () => (await get<SentGift[]>('gifts')) ?? [],
  add: async (g: SentGift) => set('gifts', [g, ...(await sentGifts.list())].slice(0, 50)),
};

/** `/gift` — "Who gets it?" resolving live, one price per size, the reclaim rule stated BEFORE paying (D-7). */
export function GiftForm({ onSent }: { onSent?: () => void }) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const walletLabel = useWalletLabel();
  const { plans } = usePlans();
  const { wallet } = useWallet('human');
  const { row, dispatch, now } = useOnchainAction();
  const [name, setName] = useState('');
  const [mb, setMb] = useState(1000);
  const [resolved, setResolved] = useState<{ name: string; mb: number; result: Resolution }>();
  const [gift, setGift] = useState<GiftResponse | undefined>();
  const typed = name.trim().toLowerCase();
  const wellFormed = typed.length >= 3 && typed.includes('.');
  const resolution: Resolution = !wellFormed
    ? 'idle'
    : resolved?.name === typed && resolved.mb === mb
      ? resolved.result
      : 'resolving';

  useEffect(() => {
    if (!wellFormed) return;
    const timer = setTimeout(() => {
      // the API resolves the name BEFORE any 402 (T-43): 402 = resolves, 404 name_unresolved = no address
      api.giftQuote(typed, mb).then(
        (res) =>
          setResolved({ name: typed, mb, result: res.status === 402 ? 'resolves' : 'error' }),
        (e: unknown) =>
          setResolved({
            name: typed,
            mb,
            result: e instanceof ApiError && e.code === 'name_unresolved' ? 'unresolved' : 'error',
          }),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [typed, wellFormed, mb]);

  const step = plans?.paid.priceUsd6PerStep ?? '400000';
  const price = priceFor(mb, step);
  const claimWindowMs = (plans?.gift.claimWindowS ?? 7 * 86_400) * 1000;
  const claimBy = now + claimWindowMs;
  const reclaimUntil = claimBy + GIFT_RECLAIM_WINDOW_S * 1000;
  const shownName = name.trim().toLowerCase();

  const send = useCallback(async () => {
    if (!wallet) return;
    dispatch({ type: 'start', at: Date.now() });
    try {
      const q = await quote('/gift', { method: 'POST', body: { name: shownName, mb } });
      const chosen = q.required.accepts.find((a) => a.network === wallet.network);
      if (!chosen) throw new ApiError(402, 'invalid_payment', 'no payable network');
      const Signer = wallet.kind === 'demo' ? DemoWalletSigner : EvmWalletSigner;
      const signer = new Signer(
        wallet,
        chosen.network,
        (plans?.paid.accepts ?? q.required.accepts).map((a) => ({
          network: a.network,
          asset: a.asset,
          payTo: a.payTo,
        })),
      );
      const paid = await pay<GiftResponse>(q, signer, undefined, await chainNow(wallet));
      if (paid.error || !paid.settlement?.success || !paid.data) {
        dispatch({ type: 'preBroadcastError', reason: paymentFailureReason(paid.error) });
        return;
      }
      dispatch({ type: 'signed', hash: paid.settlement.transaction, at: Date.now() });
      setGift(paid.data);
      await sentGifts.add({
        giftId: paid.data.giftId,
        serial: paid.data.serial,
        name: paid.data.name,
        to: paid.data.to,
        mb: paid.data.mb,
        claimBy: paid.data.claimBy,
        payer: wallet.address,
        usd6: chosen.amount,
      });
      onSent?.();
      await followTransaction({
        hash: paid.settlement.transaction,
        network: paid.settlement.network,
        label: 'gift',
        reader: wallet.reader,
        dispatch,
      });
    } catch (e) {
      dispatch(signingFailure(e));
    }
  }, [wallet, dispatch, shownName, mb, plans, onSent]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const network = wallet?.network ?? plans?.paid.accepts[0]?.network ?? '';

  return (
    <section className="gift" aria-labelledby="gift-title">
      <WalletButton wallet={wallet} />
      <h1 id="gift-title" className="screen__title" lang={lang}>
        {t('gift.title')}
      </h1>
      {!gift ? (
        <>
          <Field
            label={t('gift.name')}
            mono
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="rahul.eth"
            autoComplete="off"
            spellCheck={false}
            data-testid="gift-name"
          />
          <p
            className="resolve-line"
            role="status"
            data-state={resolution}
            data-testid="gift-resolution"
            lang={lang}
          >
            {resolution === 'resolving'
              ? t('gift.resolving')
              : resolution === 'resolves'
                ? t('gift.resolves', { name: shownName })
                : resolution === 'unresolved'
                  ? t('gift.unresolved', { name: shownName })
                  : ' '}
          </p>
          <div
            className="segmented segmented--even"
            role="radiogroup"
            aria-label={t('gift.size')}
            style={{ '--segments': SIZES_MB.length } as CSSProperties}
          >
            {SIZES_MB.map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={size === mb}
                onClick={() => setMb(size)}
              >
                <span className="segmented__main">{formatMb(size)}</span>
                <span className="ui-visually-hidden"> · </span>
                <span className="segmented__sub">{money(priceFor(size, step))}</span>
              </button>
            ))}
          </div>
          <p className="gift__rule" data-testid="gift-rule" lang={lang}>
            {t('gift.rule', {
              claimBy: dayLabel(claimBy, lang),
              reclaimUntil: dayLabel(reclaimUntil, lang),
            })}
          </p>
        </>
      ) : null}
      <ActionView
        row={row}
        now={now}
        title={
          shownName && resolution === 'resolves'
            ? t('gift.button', { mb: formatMb(mb), name: shownName, price: money(price) })
            : t('gift.buttonNoName', { mb: formatMb(mb), price: money(price) })
        }
        network={network}
        networkLabel={netName(network)}
        review={[
          { label: t('pay.rowTo'), value: <span data-hash>{shownName || '—'}</span> },
          { label: t('pay.rowFee'), value: t('pay.feeFacilitator') },
        ]}
        worstCase={t('gift.rule', {
          claimBy: dayLabel(claimBy, lang),
          reclaimUntil: dayLabel(reclaimUntil, lang),
        })}
        actionLabel={t('pay.button', { price: moneyUsdc(price) })}
        walletName={walletLabel(wallet)}
        result={
          gift ? t('gift.sent', { name: gift.name, claimBy: dayLabel(gift.claimBy, lang) }) : ''
        }
        {...(resolution !== 'resolves'
          ? {
              blocked:
                resolution === 'unresolved'
                  ? t('gift.unresolved', { name: shownName })
                  : t('gift.needName'),
            }
          : {})}
        expectedMs={expectedMsFor(network)}
        onConfirm={() => void send()}
        onRetry={() => dispatch({ type: 'retry' })}
        lang={lang}
      />
      {gift ? (
        <section className="gift__result" data-testid="gift-result">
          <p className="resolve-line">
            {gift.name} → <Hash value={gift.to} kind="address" />
          </p>
          <BoardingPass
            to={gift.name}
            from="you"
            mb={gift.mb}
            claimBy={gift.claimBy}
            pin={gift.pin}
            serial={gift.serial}
            qrUrl={`${origin}/card/${gift.serial}`}
            renderQr={renderQr}
          />
          <div className="row-actions">
            <Button
              variant="secondary"
              onClick={() => void saveCardPng(gift, `${origin}/card/${gift.serial}`)}
            >
              {t('gift.save')}
            </Button>
            <Button variant="quiet" onClick={() => window.print()}>
              {t('gift.print')}
            </Button>
            <Link
              href={`/gift/claim?id=${gift.giftId}&name=${encodeURIComponent(gift.name)}`}
              className="ui-button"
              data-variant="quiet"
              prefetch={false}
            >
              {t('gift.claimTitle')}
            </Link>
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function giftErrorText(t: (k: ReturnType<typeof errorKey>) => string, e: unknown): string {
  return t(errorKey(e instanceof ApiError ? e.code : 'network'));
}
