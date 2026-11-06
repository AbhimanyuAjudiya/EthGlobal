'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';

import { GIFT_RECLAIM_WINDOW_S, PLAN_MB } from '@ethglobal/protocol/ids';
import type { GiftResponse } from '@ethglobal/protocol/schemas';
import { BoardingPass, Button, Field, Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { ProofRows } from './IssuingRows';
import { ProofPanel } from './ProofPanel';
import { renderQr } from './QrCode';
import { saveCardPng } from './save-card';
import { useWalletLabel } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { dayLabel, formatMb, money, moneyUsdc, priceFor } from '../lib/format';
import { useEnsureChain, usePlans, useWallet, WrongChainError } from '../lib/hooks';
import {
  completePayment,
  pendingPayment,
  EvmWalletSigner,
  pay,
  paymentFailureReason,
  quote,
  signingFailure,
} from '../lib/pay402';
import { buildProof, type Proof } from '../lib/proof';
import { get, set } from '../lib/store';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { chainIdOf, chainNow, isUserRejection } from '../lib/wallet';

/** The accepts entry an EVM wallet pays a gift with: its own chain when offered, else the first EVM one (Base). */
const evmOffer = <T extends { network: string }>(accepts: readonly T[], current?: string) =>
  accepts.find((a) => a.network === current) ??
  accepts.find((a) => a.network.startsWith('eip155:'));

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
  const ensureChain = useEnsureChain();
  const { openConnectModal } = useConnectModal();
  const { row, dispatch, now } = useOnchainAction();
  const operation = useRef<Awaited<ReturnType<typeof quote>> | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [name, setName] = useState('');
  // the sizes a paid gift sells (/plans gift.sizesMb): one, 1 GB, so the size picker only appears for more than one
  const sizes = plans?.gift.sizesMb.length ? plans.gift.sizesMb : [PLAN_MB];
  const [picked, setMb] = useState<number>();
  const mb = picked !== undefined && sizes.includes(picked) ? picked : (sizes[0] ?? PLAN_MB);
  const [resolved, setResolved] = useState<{ name: string; mb: number; result: Resolution }>();
  const [gift, setGift] = useState<GiftResponse | undefined>();
  const [proof, setProof] = useState<Proof | undefined>();
  const [copied, setCopied] = useState(false);
  const typed = name.trim().toLowerCase();
  const wellFormed = typed.length >= 3 && typed.includes('.');
  const resolution: Resolution = !wellFormed
    ? 'idle'
    : resolved?.name === typed && resolved.mb === mb
      ? resolved.result
      : 'resolving';

  useEffect(() => {
    if (!wellFormed) return;
    let alive = true;
    const timer = setTimeout(() => {
      // the API resolves the name BEFORE any 402 (T-43): 402 = resolves, 404 name_unresolved = no address
      api.giftQuote(typed, mb).then(
        (res) =>
          alive &&
          setResolved({ name: typed, mb, result: res.status === 402 ? 'resolves' : 'error' }),
        (e: unknown) =>
          alive &&
          setResolved({
            name: typed,
            mb,
            result: e instanceof ApiError && e.code === 'name_unresolved' ? 'unresolved' : 'error',
          }),
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [typed, wellFormed, mb]);

  const step = plans?.paid.priceUsd6PerStep ?? '400000';
  const price = priceFor(mb, step);
  const claimWindowMs = (plans?.gift.claimWindowS ?? 7 * 86_400) * 1000;
  const claimBy = now + claimWindowMs;
  const reclaimUntil = claimBy + GIFT_RECLAIM_WINDOW_S * 1000;
  const shownName = name.trim().toLowerCase();
  useEffect(() => {
    void pendingPayment('/gift').then((q) => {
      if (!q || typeof q.init.body !== 'string') return;
      const body = JSON.parse(q.init.body) as { name: string; mb: number };
      setName(body.name);
      setMb(body.mb);
      operation.current = q;
      setLocked(true);
    });
  }, []);

  const send = useCallback(async () => {
    if (!wallet) return;
    dispatch({ type: 'start', at: Date.now() });
    let paymentStarted = false;
    setProof(undefined);
    try {
      const q =
        operation.current ??
        (await quote('/gift', { method: 'POST', body: { name: shownName, mb } }));
      operation.current = q;
      setLocked(true);
      const chosen = evmOffer(q.required.accepts, wallet.network);
      if (!chosen) throw new ApiError(402, 'invalid_payment', 'no payable network');
      // the EIP-3009 domain is that entry's chain: the wallet signs there
      const payer = await ensureChain(wallet, chainIdOf(chosen.network));
      const signer = new EvmWalletSigner(
        payer,
        chosen.network,
        (plans?.paid.accepts ?? q.required.accepts).map((a) => ({
          network: a.network,
          asset: a.asset,
          payTo: a.payTo,
        })),
      );
      paymentStarted = true;
      const paid = await pay<GiftResponse>(q, signer, undefined, await chainNow(payer));
      const x402 = { accepted: paid.paid?.accepted, settlement: paid.settlement };
      if (paid.error || !paid.settlement?.success || !paid.data) {
        if (paid.uncertain || paid.settlement?.success)
          operation.current = { ...q, recovery: true };
        if (!paid.uncertain && !paid.settlement?.success) {
          operation.current = undefined;
          setLocked(false);
        }
        setProof(buildProof({ error: paid.error ?? new Error('settlement failed'), x402 }));
        dispatch(
          paid.uncertain || paid.settlement?.success
            ? {
                type: 'uncertain',
                reason: t('payment.recoverGift'),
              }
            : { type: 'preBroadcastError', reason: paymentFailureReason(paid.error) },
        );
        return;
      }
      // the gift's pass carries its PIN: lib/proof.ts drops it from the proof
      setProof(
        buildProof({
          response: paid.data,
          status: paid.status,
          x402,
          ens: { name: paid.data.name, address: paid.data.to },
        }),
      );
      dispatch({ type: 'signed', hash: paid.settlement.transaction, at: Date.now() });
      setGift(paid.data);
      await sentGifts.add({
        giftId: paid.data.giftId,
        serial: paid.data.serial,
        name: paid.data.name,
        to: paid.data.to,
        mb: paid.data.mb,
        claimBy: paid.data.claimBy,
        payer: paid.settlement.payer ?? payer.address,
        usd6: chosen.amount,
      });
      await completePayment(q);
      onSent?.();
      await followTransaction({
        hash: paid.settlement.transaction,
        network: paid.settlement.network,
        label: 'gift',
        reader: payer.reader,
        dispatch,
      });
    } catch (e) {
      const recovering = operation.current?.recovery === true;
      if (!recovering && (!paymentStarted || isUserRejection(e))) {
        operation.current = undefined;
        setLocked(false);
      }
      if (!isUserRejection(e)) setProof(buildProof({ error: e }));
      dispatch(
        recovering
          ? {
              type: 'uncertain',
              reason: t('payment.reconnect'),
            }
          : e instanceof WrongChainError
            ? {
                type: 'preBroadcastError',
                reason: t('wallet.switchNeeded', { network: e.chainName }),
              }
            : paymentStarted && !isUserRejection(e)
              ? {
                  type: 'uncertain',
                  reason: t('payment.recover'),
                }
              : signingFailure(e),
      );
    }
  }, [wallet, ensureChain, dispatch, shownName, mb, plans, onSent, t]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const network = evmOffer(plans?.paid.accepts ?? [], wallet?.network)?.network ?? '';
  const connectFirst = resolution === 'resolves' && !wallet;

  /** The claim link goes to the recipient: the phone's share sheet where there is one, else the clipboard. */
  const shareClaim = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const url = e.currentTarget.href;
    if (typeof navigator.share === 'function') void navigator.share({ url }).catch(() => undefined);
    else
      void navigator.clipboard?.writeText(url).then(
        () => setCopied(true),
        () => undefined,
      );
  };

  return (
    <section className="gift" aria-labelledby="gift-title">
      <h1 id="gift-title" className="gift__question" lang={lang}>
        {t('gift.title')}
      </h1>
      {!gift ? (
        <>
          <Field
            label={t('gift.name')}
            mono
            value={name}
            disabled={locked || row.state === 'signing'}
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
          {sizes.length > 1 ? (
            <div
              className="segmented segmented--even"
              role="radiogroup"
              aria-label={t('gift.size')}
              style={{ '--segments': sizes.length } as CSSProperties}
            >
              {sizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={size === mb}
                  disabled={locked || row.state === 'signing'}
                  onClick={() => setMb(size)}
                >
                  <span className="segmented__main">{formatMb(size)}</span>
                  <span className="ui-visually-hidden"> · </span>
                  <span className="segmented__sub">{money(priceFor(size, step))}</span>
                </button>
              ))}
            </div>
          ) : null}
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
        actionLabel={
          connectFirst ? t('wallet.connectToPay') : t('pay.button', { price: moneyUsdc(price) })
        }
        walletName={walletLabel(wallet)}
        result={
          gift
            ? t('gift.sent', {
                name: gift.name,
                claimBy: dayLabel(gift.claimBy, lang),
                reclaimUntil: dayLabel(gift.claimBy + GIFT_RECLAIM_WINDOW_S * 1000, lang),
              })
            : ''
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
        onConfirm={() => {
          if (connectFirst) openConnectModal?.();
          else void send();
        }}
        {...(gift && row.outcomeUnknown ? {} : { onRetry: () => dispatch({ type: 'retry' }) })}
        lang={lang}
        className="gift__sheet"
      />
      {gift ? null : <ProofPanel proof={proof} />}
      {gift ? (
        <section className="gift__result" data-testid="gift-result">
          <p className="resolve-line" data-state="resolves">
            <a href={`https://app.ens.domains/${gift.name}`} target="_blank" rel="noreferrer">
              {gift.name}
            </a>{' '}
            → <Hash value={gift.to} kind="address" />
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
          <p className="note" lang={lang}>
            {t('gift.shareHow', { name: gift.name })}
          </p>
          <div className="row-actions gift__actions">
            {/* the recipient's claim page; a tap shares (or copies) it rather than opening it here */}
            <a
              href={`${origin}/gift/claim?id=${gift.giftId}&name=${encodeURIComponent(gift.name)}`}
              className="ui-button"
              data-variant="primary"
              onClick={shareClaim}
            >
              {copied ? t('install.android.copied') : t('gift.share')}
            </a>
            <Button
              variant="secondary"
              onClick={() => void saveCardPng(gift, `${origin}/card/${gift.serial}`)}
            >
              {t('gift.save')}
            </Button>
            <Button variant="quiet" onClick={() => window.print()}>
              {t('gift.print')}
            </Button>
          </div>
          <ProofPanel proof={proof} fallback={<ProofRows receipt={gift.receipt} />} />
        </section>
      ) : null}
    </section>
  );
}

export function giftErrorText(t: (k: ReturnType<typeof errorKey>) => string, e: unknown): string {
  return t(errorKey(e instanceof ApiError ? e.code : 'network'));
}
