'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseAbi, type Address } from 'viem';

import { keccak256 } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type {
  EntitledResponse,
  MeResponse,
  PaymentRequirements,
  TopUpResponse,
} from '@ethglobal/protocol/schemas';
import { formatUsd6 } from '@ethglobal/protocol/units';
import { sessionNonce } from '@ethglobal/protocol/x402';
import { MbMeter, RuledList } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { AppHeader, Screen, TabBar, WalletButton } from './Shell';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { deliver, planHref } from '../lib/deliver';
import { IS_LOCAL, networkName } from '../lib/env';
import { dayLabel, clockIst, formatMb, mmss, money, moneyUsdc, priceFor } from '../lib/format';
import { useClock, usePlans, useWallet } from '../lib/hooks';
import {
  DemoWalletSigner,
  EvmWalletSigner,
  hederaTerms,
  pay,
  paymentFailureReason,
  quote,
  type Quote,
} from '../lib/pay402';
import { beginSession } from '../lib/session-key';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { chainNow, isUserRejection } from '../lib/wallet';


const BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);
const SIZES = [100, 200, 300];

interface TestHooks {
  tamperAmount?: boolean;
}
const testHooks = (): TestHooks =>
  IS_LOCAL ? ((globalThis as { __RECHARGE_TEST__?: TestHooks }).__RECHARGE_TEST__ ?? {}) : {};

/** The Review state's 402 (and, for a new plan, the session key the delivery will be sealed to). */
async function fetchQuote(path: string, withSession: boolean): Promise<Quote & { at: number; spk?: Hex }> {
  const spk = withSession ? beginSession() : undefined;
  const next = await quote(path, spk ? { sessionPubKey: spk } : {});
  return { ...next, at: Date.now(), ...(spk ? { spk } : {}) };
}

/** The x402 terms of a Hedera accepts[] entry, as an instruction panel (human Hedera wallets are in-window). */
function HederaPanel({ req }: { req: PaymentRequirements }) {
  const { t, lang } = useLang();
  const terms = hederaTerms(req);
  return (
    <section className="hedera-panel" data-testid="hedera-panel">
      <h2 lang={lang}>{t('pay.hederaTitle')}</h2>
      <p lang={lang}>{t('pay.hederaBody')}</p>
      <RuledList
        rows={[
          { label: 'Network', value: terms.network },
          { label: 'Asset (HTS USDC)', value: <span data-hash>{terms.asset}</span> },
          { label: 'Amount', value: `${formatUsd6(BigInt(terms.amount), { unit: 'USDC' })} (${terms.amount} base units)` },
          { label: 'Pay to', value: <span data-hash>{terms.payTo}</span> },
          { label: 'Fee payer', value: <span data-hash>{terms.feePayer ?? '—'}</span> },
          { label: 'Valid for', value: `${terms.validForS} s` },
        ]}
      />
      <p className="note" lang={lang}>
        {t('pay.hederaSoon')}
      </p>
    </section>
  );
}

/** `/pay` — the 402 moment: a receipt-shaped sheet that IS the OnchainAction component. */
export function PaySheet({ entitlementKey, initialMb }: { entitlementKey?: string; initialMb?: number }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const { plans } = usePlans();
  const { wallet, busy, error: walletError, pickInjected } = useWallet('human');
  const { row, dispatch, now } = useOnchainAction();
  const clock = useClock(1000);
  const [mb, setMb] = useState(initialMb && SIZES.includes(initialMb) ? initialMb : entitlementKey ? 100 : 300);
  const [q, setQ] = useState<(Quote & { at: number; spk?: Hex }) | undefined>();
  const [quoteError, setQuoteError] = useState<string | undefined>();
  const [network, setNetwork] = useState<string | undefined>();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [me, setMe] = useState<MeResponse | undefined>();
  const [result, setResult] = useState<string | undefined>();
  const [doneKey, setDoneKey] = useState<string | undefined>();

  useEffect(() => {
    if (entitlementKey) void api.me(entitlementKey).then(setMe, () => undefined);
  }, [entitlementKey]);

  const path = entitlementKey
    ? `/esim/topup?key=${encodeURIComponent(entitlementKey)}&mb=${mb}`
    : `/esim/provision?mb=${mb}`;

  const [quoteRound, setQuoteRound] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchQuote(path, !entitlementKey).then(
      (next) => {
        if (!alive) return;
        setQuoteError(undefined);
        setQ(next);
        setNetwork((current) => current ?? next.required.accepts[0]?.network);
      },
      (e: unknown) => alive && setQuoteError(t(errorKey(e instanceof ApiError ? e.code : 'network'))),
    );
    return () => {
      alive = false;
    };
  }, [path, entitlementKey, t, quoteRound]);

  const accepts = useMemo(() => q?.required.accepts ?? [], [q]);
  const chosen = accepts.find((a) => a.network === network) ?? accepts[0];

  useEffect(() => {
    if (!wallet) return;
    for (const a of accepts) {
      if (a.network !== wallet.network) continue;
      void wallet.reader
        .readContract({
          address: a.asset as Address,
          abi: BALANCE_ABI,
          functionName: 'balanceOf',
          args: [wallet.address],
        })
        .then((v) => setBalances((b) => ({ ...b, [a.network]: v })), () => undefined);
    }
  }, [wallet, accepts]);

  const price = chosen ? moneyUsdc(chosen.amount) : plans ? moneyUsdc(priceFor(mb, plans.paid.priceUsd6PerStep)) : '';
  const shortPrice = chosen ? money(chosen.amount) : '';
  const title = entitlementKey
    ? t('pay.topup', { mb: formatMb(mb), price: shortPrice })
    : t('pay.buy', { mb: formatMb(mb), price: shortPrice });
  const isHedera = chosen?.network.startsWith('hedera:') ?? false;
  const approvalLeft = chosen && q ? q.at + chosen.maxTimeoutSeconds * 1000 - clock : 0;
  const balance = chosen ? balances[chosen.network] : undefined;

  let blocked: string | undefined;
  if (quoteError) blocked = quoteError;
  else if (isHedera) blocked = t('pay.hederaSoon');
  else if (!wallet) blocked = t('pay.noWallet');
  else if (chosen && wallet.network !== chosen.network)
    blocked = `${wallet.name} is on ${networkName(wallet.network)}; this payment is on ${networkName(chosen.network)}.`;
  else if (chosen && balance !== undefined && balance < BigInt(chosen.amount))
    blocked = `This account holds ${formatUsd6(balance, { unit: 'USDC' })}; the price is ${price}.`;

  const onConfirm = useCallback(async () => {
    if (!q || !chosen || !wallet) return;
    dispatch({ type: 'start', at: Date.now() });
    const Signer = wallet.kind === 'demo' ? DemoWalletSigner : EvmWalletSigner;
    const signer = new Signer(
      wallet,
      chosen.network,
      (plans?.paid.accepts ?? accepts).map((a) => ({ network: a.network, asset: a.asset, payTo: a.payTo })),
      { tamperAmount: Boolean(testHooks().tamperAmount) },
    );
    try {
      const paid = await pay<TopUpResponse | EntitledResponse>(q, signer, q.spk, await chainNow(wallet));
      if (paid.error || !paid.settlement?.success) {
        dispatch({ type: 'preBroadcastError', reason: paymentFailureReason(paid.error) });
        return;
      }
      const settlement = paid.settlement;
      dispatch({ type: 'signed', hash: settlement.transaction, at: Date.now() });
      if (entitlementKey) {
        const body = paid.data as TopUpResponse;
        setResult(t('pay.result', { mb: formatMb(mb), total: formatMb(body.mbTotal) }));
        setMe((m) => (m ? { ...m, mbTotal: body.mbTotal, mbUsed: body.mbUsed, remainingMb: body.mbTotal - body.mbUsed } : m));
        setDoneKey(entitlementKey);
      } else if (q.spk) {
        const body = paid.data as EntitledResponse;
        const key = await deliver(body, sessionNonce(q.spk, keccak256), {
          network: settlement.network,
          you: money(chosen.amount),
        });
        setResult(t('pay.resultNew', { mb: formatMb(mb) }));
        setDoneKey(key);
      }
      await followTransaction({
        hash: settlement.transaction,
        network: settlement.network,
        label: title,
        reader: wallet.reader,
        dispatch,
      });
    } catch (e) {
      if (isUserRejection(e)) dispatch({ type: 'rejected' });
      else dispatch({ type: 'preBroadcastError', reason: paymentFailureReason(e instanceof ApiError ? e : undefined) });
    }
  }, [q, chosen, wallet, plans, accepts, dispatch, entitlementKey, mb, t, title]);

  const validRow = me
    ? { label: t('pay.rowValid'), value: t('pay.validUntil', { when: `${dayLabel(me.expiresAt)} ${clockIst(me.expiresAt)}` }) }
    : { label: t('pay.rowValid'), value: t('pay.validDays', { days: plans?.paid.validityDays ?? 7 }) };
  const review = [
    validRow,
    { label: t('pay.rowFee'), value: t('pay.feeFacilitator') },
    ...(wallet ? [{ label: t('pay.rowFrom'), value: wallet.name }] : []),
  ];

  return (
    <Screen money>
      <AppHeader />
      <WalletButton wallet={wallet} busy={busy} error={walletError} onInjected={() => void pickInjected()} />
      {!entitlementKey ? (
        <p className="note" lang={lang}>
          {t('pay.noPlan')}
        </p>
      ) : null}
      {me ? (
        <MbMeter remainingMb={me.remainingMb} totalMb={me.mbTotal} usageAsOf={me.usageAsOf} className="pay__meter" />
      ) : null}
      {row.state === 'idle' ? (
        <div className="segmented" role="radiogroup" aria-label={t('pay.size')}>
          {SIZES.map((size) => (
            <button key={size} type="button" role="radio" aria-checked={size === mb} onClick={() => setMb(size)}>
              {formatMb(size)}
            </button>
          ))}
        </div>
      ) : null}
      {accepts.length > 0 && row.state === 'idle' ? (
        <div className="segmented" role="radiogroup" aria-label={t('pay.payFrom')} data-testid="pay-from">
          {accepts.map((a) => (
            <button
              key={a.network}
              type="button"
              role="radio"
              aria-checked={a.network === chosen?.network}
              onClick={() => setNetwork(a.network)}
            >
              {networkName(a.network)}
              {balances[a.network] !== undefined ? ` · ${formatUsd6(balances[a.network] ?? 0n)} USDC`.replace('$', '') : ''}
            </button>
          ))}
        </div>
      ) : null}
      {isHedera && chosen ? <HederaPanel req={chosen} /> : null}
      <ActionView
        row={row}
        now={now}
        title={title}
        network={chosen?.network ?? ''}
        networkLabel={networkName(chosen?.network)}
        review={review}
        worstCase={t('pay.worst', { mmss: mmss(approvalLeft) })}
        actionLabel={t('pay.button', { price })}
        walletName={wallet?.name ?? 'your wallet'}
        simulation={t('pay.simulation', { price, mb: formatMb(mb) })}
        {...(result ? { result } : {})}
        {...(blocked ? { blocked } : {})}
        expectedMs={expectedMsFor(chosen?.network)}
        onConfirm={() => void onConfirm()}
        onRetry={() => {
          dispatch({ type: 'retry' });
          setQuoteRound((n) => n + 1);
        }}
        className="pay__sheet"
      />
      {doneKey && (row.state === 'confirmed' || row.state === 'finalized') ? (
        <button type="button" className="ui-button ui-button--block" data-variant="secondary" onClick={() => router.push(planHref(doneKey))}>
          {t('pay.openPlan')}
        </button>
      ) : null}
      {entitlementKey ? (
        <p className="quiet-rows">
          <Link href={`/agent`} prefetch={false}>
            {t('agent.title')}
          </Link>
        </p>
      ) : null}
      <TabBar active="add" />
    </Screen>
  );
}
