'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { parseAbi, type Address } from 'viem';

import { keccak256 } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type {
  EntitledResponse,
  MeResponse,
  PaymentRequirements,
  TopUpResponse,
} from '@ethglobal/protocol/schemas';
import { sessionNonce } from '@ethglobal/protocol/x402';
import { Button, MbMeter, RuledList } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { AppHeader, Caution, Screen, TabBar, useWalletLabel, WalletButton } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { deliver, planHref } from '../lib/deliver';
import {
  clockIst,
  dayLabel,
  formatMb,
  mmss,
  money,
  moneyUsdc,
  priceFor,
  usdcBalance,
} from '../lib/format';
import { useClock, usePlans, useWallet } from '../lib/hooks';
import {
  DemoWalletSigner,
  EvmWalletSigner,
  hederaTerms,
  pay,
  paymentFailureReason,
  signingFailure,
  quote,
  type Quote,
} from '../lib/pay402';
import { beginSession } from '../lib/session-key';
import { plans as store } from '../lib/store';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { chainNow } from '../lib/wallet';

const BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);
const SIZES = [100, 200, 300];

/** MODE=local only: the e2e tamper hook, compiled out of a live build (lib/local/test-hooks.ts, RT-W-12). */
async function tamperAmount(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_MODE === 'local') {
    const { testHooks } = await import('../lib/local/test-hooks');
    return Boolean(testHooks().tamperAmount);
  }
  return false;
}

/** The Review state's 402 (and, for a new plan, the session key the delivery will be sealed to). */
async function fetchQuote(
  path: string,
  withSession: boolean,
): Promise<Quote & { at: number; spk?: Hex }> {
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
          { label: t('pay.hNetwork'), value: terms.network, mono: true },
          { label: t('pay.hAsset'), value: <span data-hash>{terms.asset}</span>, mono: true },
          {
            label: t('pay.hAmount'),
            value: `${moneyUsdc(BigInt(terms.amount))} · ${terms.amount}`,
            mono: true,
          },
          { label: t('pay.hPayTo'), value: <span data-hash>{terms.payTo}</span>, mono: true },
          {
            label: t('pay.hFeePayer'),
            value: <span data-hash>{terms.feePayer ?? '—'}</span>,
            mono: true,
          },
          { label: t('pay.hValidFor'), value: `${terms.validForS} s`, mono: true },
        ]}
      />
      <p className="note" lang={lang}>
        {t('pay.hederaSoon')}
      </p>
    </section>
  );
}

/**
 * `/pay?key=` for a key this device does not hold (RT-W-03): say whose plan it is — its size and expiry — and ask
 * before any 402 is fetched. Topping up someone else's plan is legitimate (a gift); doing it silently is not.
 */
function ForeignPlanGate({
  entitlementKey,
  onConfirm,
}: {
  entitlementKey: string;
  onConfirm: () => void;
}) {
  const { t, lang } = useLang();
  const [me, setMe] = useState<MeResponse | null | undefined>();
  useEffect(() => {
    api.me(entitlementKey).then(setMe, () => setMe(null));
  }, [entitlementKey]);
  return (
    <Screen money>
      <AppHeader />
      {me === undefined ? (
        <div className="skeleton skeleton--line" aria-hidden="true" />
      ) : me === null ? (
        <p className="note" role="status" data-testid="pay-foreign">
          {t('pay.notHereUnknown')}
        </p>
      ) : (
        <section className="sheet" data-testid="pay-foreign">
          <p className="sheet__lede">
            {t('pay.notHere', {
              mb: formatMb(me.mbTotal),
              when: `${dayLabel(me.expiresAt, lang)} ${clockIst(me.expiresAt)}`,
            })}
          </p>
          <Button block onClick={onConfirm} data-testid="pay-foreign-confirm">
            {t('pay.notHereButton')}
          </Button>
        </section>
      )}
      <TabBar active="add" />
    </Screen>
  );
}

/** `/pay` — the 402 moment, after the plan check: a top-up of another device's plan is asked for first. */
export function PaySheet(props: { entitlementKey?: string; initialMb?: number }) {
  const key = props.entitlementKey;
  const [owned, setOwned] = useState<boolean | undefined>(key ? undefined : true);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (key) void store.owns(key).then(setOwned);
  }, [key]);
  if (owned === undefined) return null;
  if (key && !owned && !confirmed)
    return <ForeignPlanGate entitlementKey={key} onConfirm={() => setConfirmed(true)} />;
  return <PaySheetBody {...props} />;
}

/** The receipt-shaped sheet that IS the OnchainAction component. */
function PaySheetBody({
  entitlementKey,
  initialMb,
}: {
  entitlementKey?: string;
  initialMb?: number;
}) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const walletLabel = useWalletLabel();
  const router = useRouter();
  const { plans } = usePlans();
  const { wallet } = useWallet('human');
  const { row, dispatch, now } = useOnchainAction();
  const clock = useClock(1000);
  const [mb, setMb] = useState(
    initialMb && SIZES.includes(initialMb) ? initialMb : entitlementKey ? 100 : 300,
  );
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
      (e: unknown) =>
        alive && setQuoteError(t(errorKey(e instanceof ApiError ? e.code : 'network'))),
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
        .then(
          (v) => setBalances((b) => ({ ...b, [a.network]: v })),
          () => undefined,
        );
    }
  }, [wallet, accepts]);

  const price = chosen
    ? moneyUsdc(chosen.amount)
    : plans
      ? moneyUsdc(priceFor(mb, plans.paid.priceUsd6PerStep))
      : '';
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
    blocked = t('pay.wrongNetwork', {
      wallet: walletLabel(wallet),
      have: netName(wallet.network),
      want: netName(chosen.network),
    });
  else if (chosen && balance !== undefined && balance < BigInt(chosen.amount))
    blocked = t('pay.lowBalance', { balance: usdcBalance(balance), price });

  const onConfirm = useCallback(async () => {
    if (!q || !chosen || !wallet) return;
    dispatch({ type: 'start', at: Date.now() });
    const Signer = wallet.kind === 'demo' ? DemoWalletSigner : EvmWalletSigner;
    const signer = new Signer(
      wallet,
      chosen.network,
      (plans?.paid.accepts ?? accepts).map((a) => ({
        network: a.network,
        asset: a.asset,
        payTo: a.payTo,
      })),
      { tamperAmount: await tamperAmount() },
    );
    try {
      const paid = await pay<TopUpResponse | EntitledResponse>(
        q,
        signer,
        q.spk,
        await chainNow(wallet),
      );
      if (paid.error || !paid.settlement?.success) {
        dispatch({ type: 'preBroadcastError', reason: paymentFailureReason(paid.error) });
        return;
      }
      const settlement = paid.settlement;
      dispatch({ type: 'signed', hash: settlement.transaction, at: Date.now() });
      if (entitlementKey) {
        const body = paid.data as TopUpResponse;
        setResult(t('pay.result', { mb: formatMb(mb), total: formatMb(body.mbTotal) }));
        setMe((m) =>
          m
            ? {
                ...m,
                mbTotal: body.mbTotal,
                mbUsed: body.mbUsed,
                remainingMb: body.mbTotal - body.mbUsed,
              }
            : m,
        );
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
      dispatch(signingFailure(e));
    }
  }, [q, chosen, wallet, plans, accepts, dispatch, entitlementKey, mb, t, title]);

  const validRow = me
    ? {
        label: t('pay.rowValid'),
        value: t('pay.validUntil', {
          when: `${dayLabel(me.expiresAt, lang)} ${clockIst(me.expiresAt)}`,
        }),
      }
    : {
        label: t('pay.rowValid'),
        value: t('pay.validDays', { days: plans?.paid.validityDays ?? 7 }),
      };
  const review = [
    validRow,
    { label: t('pay.rowFee'), value: t('pay.feeFacilitator') },
    ...(wallet ? [{ label: t('pay.rowFrom'), value: walletLabel(wallet) }] : []),
  ];

  return (
    <Screen money>
      <AppHeader />
      <WalletButton wallet={wallet} />
      {!entitlementKey ? (
        <>
          <p className="note" lang={lang}>
            {t('pay.noPlan')}
          </p>
          {/* a new plan's activation code is sealed to this browser's session */}
          <Caution k="warn.thisBrowser" />
        </>
      ) : null}
      {me ? (
        <MbMeter
          remainingMb={me.remainingMb}
          totalMb={me.mbTotal}
          usageAsOf={me.usageAsOf}
          lang={lang}
          className="pay__meter"
        />
      ) : null}
      {row.state === 'idle' ? (
        <div
          className="segmented segmented--even"
          role="radiogroup"
          aria-label={t('pay.size')}
          style={{ '--segments': SIZES.length } as CSSProperties}
        >
          {SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={size === mb}
              onClick={() => setMb(size)}
            >
              {formatMb(size)}
            </button>
          ))}
        </div>
      ) : null}
      {accepts.length > 0 && row.state === 'idle' ? (
        <div
          className="segmented"
          role="radiogroup"
          aria-label={t('pay.payFrom')}
          data-testid="pay-from"
        >
          {accepts.map((a) => (
            <button
              key={a.network}
              type="button"
              role="radio"
              aria-checked={a.network === chosen?.network}
              onClick={() => setNetwork(a.network)}
            >
              {netName(a.network)}
              {balances[a.network] !== undefined
                ? ` · ${usdcBalance(balances[a.network] ?? 0n)}`
                : ''}
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
        networkLabel={netName(chosen?.network)}
        review={review}
        worstCase={t('pay.worst', { mmss: mmss(approvalLeft) })}
        actionLabel={t('pay.button', { price })}
        walletName={walletLabel(wallet)}
        simulation={t('pay.simulation', { price, mb: formatMb(mb) })}
        {...(result ? { result } : {})}
        {...(blocked ? { blocked } : {})}
        expectedMs={expectedMsFor(chosen?.network)}
        onConfirm={() => void onConfirm()}
        onRetry={() => {
          dispatch({ type: 'retry' });
          setQuoteRound((n) => n + 1);
        }}
        lang={lang}
        className="pay__sheet"
      />
      {doneKey && (row.state === 'confirmed' || row.state === 'finalized') ? (
        <button
          type="button"
          className="ui-button ui-button--block"
          data-variant="secondary"
          onClick={() => router.push(planHref(doneKey))}
        >
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
