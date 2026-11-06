'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
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
  ReceiptRef,
  TopUpResponse,
} from '@ethglobal/protocol/schemas';
import { sessionNonce, type PaymentSigner } from '@ethglobal/protocol/x402';
import { Button, MbMeter, RuledList } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { ProofRows } from './IssuingRows';
import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
import { AppHeader, Caution, Screen, TabBar, useWalletLabel } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { deliver, planHref } from '../lib/deliver';
import { isHandheld } from '../lib/device';
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
  DemoWalletSigner,
  EvmWalletSigner,
  hederaTerms,
  pay,
  paymentFailureReason,
  signingFailure,
  quote,
  type Quote,
} from '../lib/pay402';
import { buildProof, type Proof } from '../lib/proof';
import { beginSession } from '../lib/session-key';
import { plans as store } from '../lib/store';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { chainIdOf, chainNow, isUserRejection, type Wallet } from '../lib/wallet';

import type { HashPackSession } from '../lib/hedera-wc';

const BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

/** A Hedera offer on an LPA-delivering route: HashPack cannot carry the session key yet, so it pays top-ups only (RT-W-14). */
const sessionBound = (a: PaymentRequirements | undefined): boolean =>
  Boolean(a?.network.startsWith('hedera:')) && a?.extra?.sessionKeyRequired === true;

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

/** HashPack's pairing state on the Review screen. */
interface HashPackState {
  uri?: string;
  link?: string;
  session?: HashPackSession;
  failed?: boolean;
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
  const terms = hederaTerms(req);
  const handheld = typeof window !== 'undefined' && isHandheld(window);
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
      {hp.session ? (
        <>
          <p className="note" lang={lang} data-testid="hashpack-account">
            {t('pay.hashpackAccount', { account: hp.session.accountId })}
          </p>
          {/* on a phone the signature request waits inside HashPack: one tap brings it forward */}
          {handheld && hp.link ? (
            <a className="ui-button ui-button--block" data-variant="secondary" href={hp.link}>
              {t('pay.hashpackOpen')}
            </a>
          ) : null}
        </>
      ) : hp.uri ? (
        <>
          <p className="note" lang={lang}>
            {t('pay.hashpackScan')}
          </p>
          <QrCode url={hp.uri} label={t('pay.hashpackScan')} sizeMm={48} />
          {handheld && hp.link ? (
            <a className="ui-button ui-button--block" href={hp.link}>
              {t('pay.hashpackOpen')}
            </a>
          ) : null}
        </>
      ) : (
        <Button block onClick={onConnect} data-testid="hashpack-connect">
          {t('pay.hashpackConnect')}
        </Button>
      )}
      {hp.failed ? (
        <p className="note" role="alert" lang={lang}>
          {t('pay.hashpackFailed')}
        </p>
      ) : null}
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
        // a new plan starts on a network that can pay for it, not on Hedera (RT-W-14: the API lists Hedera first)
        const offers = next.required.accepts;
        setNetwork(
          (current) => current ?? (offers.find((a) => !sessionBound(a)) ?? offers[0])?.network,
        );
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

  const price = chosen ? moneyUsdc(chosen.amount) : plans ? moneyUsdc(planUsd6) : '';
  // the 402's own amount once quoted; until then the plan's list price, never an empty "Buy 1 GB · "
  const shortPrice = money(chosen ? chosen.amount : planUsd6);
  const title = entitlementKey
    ? t('pay.topup', { mb: formatMb(mb), price: shortPrice })
    : t('pay.buy', { mb: formatMb(mb), price: shortPrice });
  const isHedera = chosen?.network.startsWith('hedera:') ?? false;
  const approvalLeft = chosen && q ? q.at + chosen.maxTimeoutSeconds * 1000 - clock : 0;
  const balance = chosen ? balances[chosen.network] : undefined;

  // an LPA-delivering route binds the session key, which a Hedera payload cannot carry yet (octroi refuses it)
  const hederaSessionBound = sessionBound(chosen);
  const payableInstead = hederaSessionBound ? accepts.find((a) => !sessionBound(a)) : undefined;
  let blocked: string | undefined;
  if (quoteError) blocked = quoteError;
  else if (hederaSessionBound) blocked = t('pay.hederaTopupOnly');
  else if (isHedera && hp.session?.chain !== chosen?.network) blocked = t('pay.hashpackNeeded');
  // no wallet yet: the pay button itself opens the connect modal; a wallet on another chain is switched on Pay
  else if (isHedera || !wallet) blocked = undefined;
  else if (chosen && balance !== undefined && balance < BigInt(chosen.amount))
    blocked = t('pay.lowBalance', { balance: usdcBalance(balance), price });
  const connectFirst = !blocked && !isHedera && !wallet;

  const onConnect = useCallback(async () => {
    if (!chosen) return;
    setHp({});
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
    if (!q || !chosen || (isHedera ? !session : !wallet)) return;
    dispatch({ type: 'start', at: Date.now() });
    const allow = (plans?.paid.accepts ?? accepts).map((a) => ({
      network: a.network,
      asset: a.asset,
      payTo: a.payTo,
    }));
    try {
      let signer: PaymentSigner;
      let payer: Wallet | undefined;
      if (session) {
        // Hedera: no session key on the wire (LPA routes are blocked above), the PWA clock (validStart is back-dated)
        const hw = await import('../lib/hedera-wc');
        signer = await hw.hashPackPaySigner(session, allow);
      } else {
        // the EIP-3009 domain is the accepts entry's chain (Base Sepolia): the wallet signs there
        payer = await ensureChain(wallet!, chainIdOf(chosen.network));
        const Signer = payer.kind === 'demo' ? DemoWalletSigner : EvmWalletSigner;
        signer = new Signer(payer, chosen.network, allow, { tamperAmount: await tamperAmount() });
      }
      const paid = await pay<TopUpResponse | EntitledResponse>(
        q,
        signer,
        session ? undefined : q.spk,
        payer ? await chainNow(payer) : Date.now(),
      );
      // the decoded x402 headers: the accepts entry that was signed, the PAYMENT-RESPONSE settlement
      const x402 = { accepted: paid.paid?.accepted, settlement: paid.settlement };
      if (paid.error || !paid.settlement?.success) {
        setProof(buildProof({ error: paid.error ?? new Error('settlement failed'), x402 }));
        dispatch({ type: 'preBroadcastError', reason: paymentFailureReason(paid.error) });
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
              }
            : m,
        );
        setDoneKey(entitlementKey);
      } else if (q.spk) {
        const body = paid.data as EntitledResponse;
        const key = await deliver(body, sessionNonce(q.spk, keccak256), {
          network: settlement.network,
          you: money(chosen.amount),
          proof: issued,
        });
        setResult(t('pay.resultNew', { mb: formatMb(mb) }));
        setReceipt(body.receipt);
        setDoneKey(key);
      }
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
        e instanceof WrongChainError
          ? {
              type: 'preBroadcastError',
              reason: t('wallet.switchNeeded', { network: e.chainName }),
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
    mb,
    t,
    title,
  ]);

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
    <Screen money>
      <AppHeader />
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
      {!entitlementKey && row.state === 'idle' ? (
        <p className="pay__option" data-testid="pay-option" lang={lang}>
          {t('pay.option', {
            mb: formatMb(mb),
            days: plans?.paid.validityDays ?? 7,
            price: money(planUsd6),
          })}
        </p>
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
      {isHedera && chosen && !hederaSessionBound ? (
        <HederaPanel req={chosen} hp={hp} onConnect={() => void onConnect()} />
      ) : null}
      <ActionView
        row={row}
        now={now}
        title={title}
        network={chosen?.network ?? ''}
        networkLabel={netName(chosen?.network)}
        review={review}
        worstCase={t('pay.worst', { mmss: mmss(approvalLeft) })}
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
          dispatch({ type: 'retry' });
          setProof(undefined);
          setQuoteRound((n) => n + 1);
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
        // a new plan cannot be paid on Hedera: one tap moves the buyer to the network that can (RT-W-14)
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
