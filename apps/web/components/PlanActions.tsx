'use client';

/**
 * The owner's two plan actions on /plan/[key], while the eSIM is not installed yet:
 * - Send to someone: the activation code leaves this browser only through the share sheet or the clipboard, inside
 *   the message text — never in a URL, never in a log (T-61, T-62). A browser without the code says where it is.
 * - Cancel & refund (paid plans /me reports refundable): an inline confirmation, then EIP-712 CancelPlan signed by
 *   the wallet that paid; the API re-checks everything and refunds that wallet only. /me's cancel fields keep the
 *   final state on the page.
 */
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useEffect, useState } from 'react';

import type { MeResponse, PlanRefund } from '@ethglobal/protocol/schemas';
import { CANCEL_PLAN_TYPES, rechargeDomain } from '@ethglobal/protocol/typed-data';
import { Button, Hash, Icon } from '@ethglobal/ui/components';

import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey, type StringKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { config, explorerName, explorerTemplate } from '../lib/env';
import { money } from '../lib/format';
import { useClock, useWallet } from '../lib/hooks';
import { isLpa } from '../lib/lpa-links';
import { payerSessionKey } from '../lib/redeem';
import { plans } from '../lib/store';
import { chainNow, isUserRejection, type Wallet } from '../lib/wallet';

/** API refusals (details.reason) with their own sentence; anything else is the error code's copy. */
const REASONS: Readonly<Record<string, StringKey>> = {
  installed: 'plan.cancelInstalled',
  'vendor-refused': 'plan.cancelRefused',
  'already-cancelled': 'plan.cancelAlready',
  treasury_cap: 'plan.cancelCap',
};

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function PlanActions({ entitlementKey, me }: { entitlementKey: string; me: MeResponse }) {
  const now = useClock(60_000);
  const [refunded, setRefunded] = useState<PlanRefund | undefined>();
  const refund = refunded ?? me.refund;
  if (refund) return <Cancelled refund={refund} />;
  if (me.status !== 'ready' || me.expiresAt <= now) return null;
  return (
    <>
      <SendPlan entitlementKey={entitlementKey} />
      {me.refundable ? (
        <CancelPlan
          entitlementKey={entitlementKey}
          offer={me.refundable}
          onCancelled={(r) => {
            setRefunded(r);
            // the profile is cancelled: its activation code is useless now and leaves this device
            void plans.forgetLpa(entitlementKey);
          }}
        />
      ) : null}
    </>
  );
}

function SendPlan({ entitlementKey }: { entitlementKey: string }) {
  const { t, lang } = useLang();
  const [lpa, setLpa] = useState<string | null | undefined>();
  const [outcome, setOutcome] = useState<'copied' | 'failed' | undefined>();

  useEffect(() => {
    let alive = true;
    void plans.lpa(entitlementKey).then((stored) => alive && setLpa(isLpa(stored) ? stored : null));
    return () => {
      alive = false;
    };
  }, [entitlementKey]);

  const send = async (code: string) => {
    const text = t('plan.shareText', {
      lpa: code,
      link: `${window.location.origin}${planHref(entitlementKey)}`,
    });
    setOutcome(undefined);
    if ('share' in navigator) {
      try {
        await navigator.share({ title: t('plan.shareTitle'), text });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return; // the sheet was closed
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setOutcome('copied');
    } catch {
      setOutcome('failed'); // no clipboard here (or permission denied)
    }
  };

  if (lpa === undefined) return null;
  return (
    <section className="sheet-row" aria-labelledby="plan-send-title" data-testid="plan-send">
      <h2 id="plan-send-title" className="sheet__kicker" lang={lang}>
        {t('plan.sendTitle')}
      </h2>
      {lpa === null ? (
        <p className="note" lang={lang}>
          {t('plan.sendElsewhere')}
        </p>
      ) : (
        <>
          <p className="warning-line caution" lang={lang}>
            <Icon name="warning" /> {t('plan.sendWarn')}
          </p>
          <div className="row-actions">
            <Button
              variant="secondary"
              onClick={() => void send(lpa)}
              data-testid="plan-send-button"
            >
              {t('plan.send')}
            </Button>
          </div>
          {outcome ? (
            <p className="note" role="status" lang={lang}>
              {t(outcome === 'copied' ? 'plan.sendCopied' : 'plan.sendFailed')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

type Step = 'idle' | 'confirm' | 'signing' | 'sending';

function CancelPlan({
  entitlementKey,
  offer,
  onCancelled,
}: {
  entitlementKey: string;
  offer: NonNullable<MeResponse['refundable']>;
  onCancelled: (refund: PlanRefund) => void;
}) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const { wallet } = useWallet('human');
  const { openConnectModal } = useConnectModal();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | undefined>();
  const amount = money(offer.usd6);
  const busy = step === 'signing' || step === 'sending';

  const cancel = async (w: Wallet) => {
    setError(undefined);
    setStep('signing');
    try {
      const challenge = await api.challenge('/plan/cancel', payerSessionKey(w.address));
      const issuedAt = await chainNow(w);
      const signature = await w.signTypedData({
        domain: rechargeDomain(config.chainId),
        types: CANCEL_PLAN_TYPES,
        primaryType: 'CancelPlan',
        message: {
          entitlementKey,
          payer: w.address,
          nonce: challenge.nonce,
          issuedAt: BigInt(issuedAt),
        },
      });
      setStep('sending');
      const res = await api.planCancel({
        entitlementKey,
        payer: w.address,
        challenge,
        issuedAt,
        signature,
      });
      onCancelled(res.refund);
    } catch (e) {
      setStep('confirm');
      if (isUserRejection(e)) return;
      const reason =
        e instanceof ApiError ? (e.details as { reason?: string } | undefined)?.reason : undefined;
      const key = reason === undefined ? undefined : REASONS[reason];
      setError(t(key ?? errorKey(e instanceof ApiError ? e.code : 'network')));
    }
  };

  if (step === 'idle')
    return (
      <section className="sheet-row" data-testid="plan-cancel">
        <div className="row-actions">
          <Button
            variant="quiet"
            onClick={() => setStep('confirm')}
            data-testid="plan-cancel-button"
          >
            {t('plan.cancel', { amount })}
          </Button>
        </div>
      </section>
    );

  const isPayer = wallet?.address.toLowerCase() === offer.to.toLowerCase();
  return (
    <section
      className="sheet-row"
      role="group"
      aria-labelledby="plan-cancel-ask"
      data-testid="plan-cancel-confirm"
    >
      <p id="plan-cancel-ask" lang={lang}>
        {t('plan.cancelConfirm', {
          amount,
          payer: short(offer.to),
          network: netName(offer.network),
        })}
      </p>
      <div className="row-actions">
        {!wallet ? (
          <Button variant="secondary" disabled={!openConnectModal} onClick={openConnectModal}>
            {t('plan.cancelConnect')}
          </Button>
        ) : isPayer ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void cancel(wallet)}
            data-testid="plan-cancel-yes"
          >
            {step === 'signing'
              ? t('plan.cancelSigning')
              : step === 'sending'
                ? t('plan.cancelSending')
                : t('plan.cancelYes', { amount })}
          </Button>
        ) : null}
        <Button variant="quiet" disabled={busy} onClick={() => setStep('idle')}>
          {t('plan.cancelNo')}
        </Button>
      </div>
      {wallet && !isPayer ? (
        <p className="note" role="status" lang={lang}>
          {t('plan.cancelWrongWallet', { payer: short(offer.to) })}
        </p>
      ) : null}
      {error ? (
        <p className="note" role="alert" lang={lang}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The final state: refunded (with the refund transaction) or pending (the operator sends it). */
function Cancelled({ refund }: { refund: PlanRefund }) {
  const { t, lang } = useLang();
  const amount = money(refund.usd6);
  const template = explorerTemplate(refund.network);
  const name = explorerName(refund.network);
  return (
    <section className="sheet-row" role="status" data-testid="plan-cancelled">
      <p lang={lang}>
        {refund.tx ? t('plan.cancelled', { amount }) : t('plan.refundPending', { amount })}
      </p>
      {refund.tx ? (
        <Hash
          value={refund.tx}
          kind="refund transaction"
          lang={lang}
          {...(template ? { explorerHref: template.replace('{hash}', refund.tx) } : {})}
          {...(name ? { explorerName: name } : {})}
        />
      ) : (
        <p className="note" lang={lang}>
          {t('plan.refundSupport')}
        </p>
      )}
    </section>
  );
}
