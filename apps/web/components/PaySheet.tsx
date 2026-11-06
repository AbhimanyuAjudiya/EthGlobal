'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAbi, type Address } from 'viem';

import { keccak256 } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type {
  EntitledResponse,
  MeResponse,
  PaymentRequirements,
  ReceiptRef,
  TopUpResponse,
} from '@ethglobal/protocol/schemas';
import { sessionNonce, type PaymentSigner } from '@ethglobal/protocol/x402';
import { Button, MbMeter, RuledList } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { HashPackConnection, type HashPackState } from './HashPackConnection';
import { ProofRows } from './IssuingRows';
import { ProofPanel } from './ProofPanel';
import { AppHeader, Caution, Screen, TabBar, useWalletLabel } from './Shell';
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
  soldPlan,
  usdcBalance,
} from '../lib/format';
import { useClock, useEnsureChain, usePlans, useWallet, WrongChainError } from '../lib/hooks';
import {
  completePayment,
  pendingPayment,
  EvmWalletSigner,
  hederaTerms,
  pay,
  paymentFailureReason,
  signingFailure,
  quote,
  type Quote,
} from '../lib/pay402';
import { buildProof, type Proof } from '../lib/proof';
import { beginSession, persistSession } from '../lib/session-key';
import { plans as store } from '../lib/store';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { chainIdOf, chainNow, isUserRejection, type Wallet } from '../lib/wallet';

const BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

/** A new native plan is offered only when the API explicitly supports a signed memo binding. */
const sessionBound = (a: PaymentRequirements | undefined): boolean =>
  Boolean(a?.network.startsWith('hedera:')) &&
  a?.extra?.sessionKeyRequired === true &&
  a.extra.sessionBinding !== 'hedera-memo-v1';

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
  const previous = await pendingPayment(path);
  if (previous) return { ...previous, recovery: true, at: Date.now() };
  const spk = withSession ? beginSession() : undefined;
  if (spk) await persistSession(spk);
  const next = await quote(path, spk ? { sessionPubKey: spk } : {});
  return { ...next, at: Date.now() };
}

/** The x402 terms of a Hedera accepts[] entry and the HashPack connect step (QR, or a deep link on a phone). */
function HederaPanel({
  req,
  hp,
  onConnect,
}: {
  req: PaymentRequirements;
  hp: HashPackState;
  onConnect: () => void;
}) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const terms = hederaTerms(req);
  return (
    <section className="hedera-panel" data-testid="hedera-panel">
      <h2 lang={lang}>{t('pay.hederaTitle')}</h2>
      <p lang={lang}>{t('pay.hederaBody')}</p>
      <RuledList
        rows={[
          { label: t('pay.hNetwork'), value: netName(terms.network) },
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
      <HashPackConnection state={hp} onConnect={onConnect} />
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
    <Screen money className="pay-screen">
      <AppHeader />
      {me === undefined ? (
        <div className="skeleton skeleton--line" aria-hidden="true" />
      ) : me === null ? (
        <p className="note" role="status" data-testid="pay-foreign">
          {t('pay.notHereUnknown')}
        </p>
      ) : (
        <section className="pay-gate" data-testid="pay-foreign">
          <p lang={lang}>
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
export function PaySheet(props: { entitlementKey?: string }) {
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
function PaySheetBody({ entitlementKey }: { entitlementKey?: string }) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const walletLabel = useWalletLabel();
  const router = useRouter();
  const { plans } = usePlans();
  const { wallet } = useWallet('human');
  const ensureChain = useEnsureChain();
  const { openConnectModal } = useConnectModal();
  const { row, dispatch, now } = useOnchainAction();
  const clock = useClock(1000);
  // one size, from /plans (paid.sizesMb): a new plan and a top-up are each 1 GB
  const sold = useMemo(() => soldPlan(plans), [plans]);
  const { mb, usd6: planUsd6 } = sold;
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);
  const [q, setQ] = useState<(Quote & { at: number; spk?: Hex }) | undefined>();
  const [quoteError, setQuoteError] = useState<string | undefined>();
  const [network, setNetwork] = useState<string | undefined>();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [me, setMe] = useState<MeResponse | undefined>();
  const [result, setResult] = useState<string | undefined>();
  const [receipt, setReceipt] = useState<ReceiptRef | undefined>();
  const [proof, setProof] = useState<Proof | undefined>();
  const [doneKey, setDoneKey] = useState<string | undefined>();
  const [hp, setHp] = useState<HashPackState>({});

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
        // Preserve the selected network, otherwise use the first supported offer.
        const offers = next.required.accepts;
        setNetwork(
          (current) => current ?? (offers.find((a) => !sessionBound(a)) ?? offers[0])?.network,
        );
      },
      (e: unknown) =>
        alive &&
        setQuoteError(translate.current(errorKey(e instanceof ApiError ? e.code : 'network'))),
    );
    return () => {
      alive = false;
    };
  }, [path, entitlementKey, quoteRound]);

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

  const price = chosen ? moneyUsdc(chosen.amount) : plans ? moneyUsdc(planUsd6) : '';
  // the 402's own amount once quoted; until then the plan's list price, never an empty "Buy 1 GB · "
  const shortPrice = money(chosen ? chosen.amount : planUsd6);
  const title = entitlementKey
    ? t('pay.topup', { mb: formatMb(mb), price: shortPrice })
    : t('pay.buy', { mb: formatMb(mb), price: shortPrice });
  const isHedera = chosen?.network.startsWith('hedera:') ?? false;
  const approvalLeft = chosen && q ? q.at + chosen.maxTimeoutSeconds * 1000 - clock : 0;
  const balance = chosen ? balances[chosen.network] : undefined;

  // Old APIs without native session binding remain unavailable for a new purchase.
  const hederaSessionBound = sessionBound(chosen);
  const payableInstead = hederaSessionBound ? accepts.find((a) => !sessionBound(a)) : undefined;
  let blocked: string | undefined;
  if (entitlementKey && me && (me.cancelledAt !== undefined || me.expiresAt <= clock))
    blocked = t('plan.ended');
  else if (entitlementKey && me?.topUpAvailable === false) blocked = t('plan.eventBundleOnly');
  else if (quoteError) blocked = quoteError;
  else if (hederaSessionBound) blocked = t('pay.hederaUnavailable');
  else if (isHedera && hp.session?.chain !== chosen?.network) blocked = t('pay.hashpackNeeded');
  // no wallet yet: the pay button itself opens the connect modal; a wallet on another chain is switched on Pay
  else if (isHedera || !wallet) blocked = undefined;
  else if (
    !q?.recovery &&
    !row.outcomeUnknown &&
    chosen &&
    balance !== undefined &&
    balance < BigInt(chosen.amount)
  )
    blocked = t('pay.lowBalance', { balance: usdcBalance(balance), price });
  const connectFirst = !blocked && !isHedera && !wallet;

  const onConnect = useCallback(async () => {
    if (!chosen) return;
    setHp({ connecting: true });
    try {
      const hw = await import('../lib/hedera-wc');
      if (!hw.isHederaChain(chosen.network))
        throw new Error(`not a Hedera chain: ${chosen.network}`);
      const { uri, session } = await hw.connectHashPack(chosen.network);
      if (uri) setHp({ uri, link: hw.hashPackLink(uri) });
      setHp({ session: await session, link: hw.hashPackLink() });
    } catch {
      setHp({ failed: true });
    }
  }, [chosen]);

  const onConfirm = useCallback(async () => {
    const session = isHedera ? hp.session : undefined;
    if (
      !q ||
      !chosen ||
      (isHedera ? !session : !wallet) ||
      (entitlementKey && me?.topUpAvailable === false)
    )
      return;
    dispatch({ type: 'start', at: Date.now() });
    let paymentStarted = false;
    const allow = (plans?.paid.accepts ?? accepts).map((a) => ({
      network: a.network,
      asset: a.asset,
      payTo: a.payTo,
    }));
    try {
      let signer: PaymentSigner;
      let payer: Wallet | undefined;
      if (session) {
        // Native purchases bind the delivery session in the signed transfer memo.
        const hw = await import('../lib/hedera-wc');
        signer = await hw.hashPackPaySigner(session, allow);
      } else {
        // the EIP-3009 domain is the accepts entry's chain (Base Sepolia): the wallet signs there
        payer = await ensureChain(wallet!, chainIdOf(chosen.network));
        signer = new EvmWalletSigner(payer, chosen.network, allow, {
          tamperAmount: await tamperAmount(),
        });
      }
      paymentStarted = true;
      const paid = await pay<TopUpResponse | EntitledResponse>(
        q,
        signer,
        q.spk,
        payer ? await chainNow(payer) : Date.now(),
      );
      // the decoded x402 headers: the accepts entry that was signed, the PAYMENT-RESPONSE settlement
      const x402 = { accepted: paid.paid?.accepted, settlement: paid.settlement };
      if (paid.error || !paid.settlement?.success) {
        setProof(buildProof({ error: paid.error ?? new Error('settlement failed'), x402 }));
        dispatch(
          paid.uncertain || paid.settlement?.success
            ? {
                type: 'uncertain',
                reason: t('payment.recover'),
              }
            : { type: 'preBroadcastError', reason: paymentFailureReason(paid.error) },
        );
        return;
      }
      const settlement = paid.settlement;
      const issued = buildProof({ response: paid.data, status: paid.status, x402 });
      setProof(issued);
      dispatch({ type: 'signed', hash: settlement.transaction, at: Date.now() });
      if (entitlementKey) {
        const body = paid.data as TopUpResponse;
        setResult(t('pay.result', { mb: formatMb(mb), total: formatMb(body.mbTotal) }));
        setReceipt(body.receipt);
        setMe((m) =>
          m
            ? {
                ...m,
                mbTotal: body.mbTotal,
                mbUsed: body.mbUsed,
                remainingMb: body.mbTotal - body.mbUsed,
                expiresAt: body.expiresAt,
              }
            : m,
        );
        setDoneKey(entitlementKey);
      } else if (q.spk) {
        const body = paid.data as EntitledResponse;
        const key = await deliver(
          body,
          sessionNonce(q.spk, keccak256),
          {
            network: settlement.network,
            you: money(chosen.amount),
            proof: issued,
          },
          q.spk,
        );
        setResult(t('pay.resultNew', { mb: formatMb(mb) }));
        setReceipt(body.receipt);
        setDoneKey(key);
      }
      await completePayment(q);
      await followTransaction({
        hash: settlement.transaction,
        network: settlement.network,
        label: title,
        reader: payer?.reader,
        dispatch,
      });
    } catch (e) {
      if (!isUserRejection(e)) setProof(buildProof({ error: e }));
      dispatch(
        q.recovery
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
  }, [
    q,
    chosen,
    wallet,
    ensureChain,
    hp.session,
    isHedera,
    plans,
    accepts,
    dispatch,
    entitlementKey,
    me?.topUpAvailable,
    mb,
    t,
    title,
  ]);

  const validRow = me
    ? {
        label: t('pay.rowValid'),
        value: doneKey
          ? t('pay.validUntil', {
              when: `${dayLabel(me.expiresAt, lang)} ${clockIst(me.expiresAt)}`,
            })
          : t('pay.topupValid', { days: plans?.paid.validityDays ?? 7 }),
      }
    : {
        label: t('pay.rowValid'),
        value: t('pay.validDays', { days: plans?.paid.validityDays ?? 7 }),
      };
  const review = [
    validRow,
    { label: t('pay.rowFee'), value: t('pay.feeFacilitator') },
    ...(isHedera
      ? hp.session
        ? [
            {
              label: t('pay.rowFrom'),
              value: t('pay.hashpackAccount', { account: hp.session.accountId }),
            },
          ]
        : []
      : wallet
        ? [{ label: t('pay.rowFrom'), value: walletLabel(wallet) }]
        : []),
  ];

  return (
    <Screen money wide className="pay-screen">
      <AppHeader />
      <div className="pay-desk">
        <section className="pay-desk__object">
          <h1 className="pay-title" lang={lang}>
            {t(entitlementKey ? 'pay.topupHeading' : 'pay.heading')}
          </h1>
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
          {isHedera && chosen && !hederaSessionBound ? (
            <HederaPanel
              req={chosen}
              hp={{
                ...hp,
                connecting: hp.connecting === true || !['idle', 'failed'].includes(row.state),
              }}
              onConnect={() => void onConnect()}
            />
          ) : null}
          <ActionView
            row={row}
            now={now}
            title={title}
            network={chosen?.network ?? ''}
            networkLabel={netName(chosen?.network)}
            review={review}
            {...(q &&
            chosen &&
            !quoteError &&
            !q.recovery &&
            row.state === 'idle' &&
            approvalLeft > 0
              ? { worstCase: t('pay.worst', { mmss: mmss(approvalLeft) }) }
              : {})}
            actionLabel={connectFirst ? t('wallet.connectToPay') : t('pay.button', { price })}
            walletName={isHedera ? 'HashPack' : walletLabel(wallet)}
            simulation={t('pay.simulation', { price, mb: formatMb(mb) })}
            {...(result ? { result } : {})}
            {...(blocked ? { blocked } : {})}
            expectedMs={expectedMsFor(chosen?.network)}
            onConfirm={() => {
              if (connectFirst) openConnectModal?.();
              else void onConfirm();
            }}
            onRetry={() => {
              if (row.outcomeUnknown && row.hash && doneKey) {
                router.push('/receipts');
                return;
              }
              if (row.outcomeUnknown)
                setQ((current) => (current ? { ...current, recovery: true } : current));
              dispatch({ type: 'retry' });
              setProof(undefined);
              if (!row.outcomeUnknown) setQuoteRound((n) => n + 1);
            }}
            lang={lang}
            className="pay__sheet"
          />
          {quoteError && row.state === 'idle' ? (
            // the price did not load (network, API): ask again rather than leave a disabled button
            <Button block variant="secondary" onClick={() => setQuoteRound((n) => n + 1)}>
              {t('verify.retry')}
            </Button>
          ) : null}
          {payableInstead && row.state === 'idle' ? (
            // A legacy API may not support native purchases yet.
            <Button block variant="secondary" onClick={() => setNetwork(payableInstead.network)}>
              {t('pay.useNetwork', { network: netName(payableInstead.network) })}
            </Button>
          ) : null}
          <ProofPanel
            proof={proof}
            fallback={receipt && row.state !== 'failed' ? <ProofRows receipt={receipt} /> : null}
          />
          {/* the plan exists once the API settled, even while the chain read is still catching up */}
          {doneKey && row.state !== 'failed' ? (
            <button
              type="button"
              className="ui-button ui-button--block"
              data-variant="secondary"
              onClick={() => router.push(planHref(doneKey))}
            >
              {t('pay.openPlan')}
            </button>
          ) : null}
        </section>
        <aside className="pay-desk__details" aria-label={t('landing.paidPlan')}>
          <p className="pay-intro" lang={lang}>
            {t(entitlementKey ? 'pay.topupIntro' : 'pay.intro', {
              days: plans?.paid.validityDays ?? 7,
            })}
          </p>
          {me ? (
            <MbMeter
              remainingMb={me.remainingMb}
              totalMb={me.mbTotal}
              usageAsOf={me.usageAsOf}
              lang={lang}
              className="pay__meter"
            />
          ) : null}
          <dl className="pay-facts">
            <div>
              <dt lang={lang}>{t('flow.coverage')}</dt>
              <dd>{formatMb(mb)}</dd>
            </div>
          </dl>
          <p className="note" lang={lang}>
            {t('flow.dataOnly')}
          </p>
          {!entitlementKey && row.state === 'idle' ? (
            <p className="pay__option" data-testid="pay-option" lang={lang}>
              {t('pay.option', {
                mb: formatMb(mb),
                days: plans?.paid.validityDays ?? 7,
                price: money(planUsd6),
              })}
            </p>
          ) : null}
          {!entitlementKey ? (
            <>
              <p className="note" lang={lang}>
                {t('pay.noPlan')}
              </p>
              {/* a new plan's activation code is sealed to this browser's session */}
              <Caution k="warn.thisBrowser" />
            </>
          ) : null}
          <Caution k="warn.unlocked" />
          {entitlementKey ? (
            <p className="pay-desk__links">
              <Link href={`/agent`} prefetch={false}>
                {t('agent.title')}
              </Link>
            </p>
          ) : null}
        </aside>
      </div>
      <TabBar active="add" />
    </Screen>
  );
}
