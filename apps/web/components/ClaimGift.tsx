'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { GiftReclaimResponse } from '@ethglobal/protocol/schemas';
import { Button, Hash, Receipt } from '@ethglobal/ui/components';

import { sentGifts, type SentGift } from './GiftForm';
import { ProofRows } from './IssuingRows';
import { PinField } from './PinField';
import { ProofPanel } from './ProofPanel';
import { Caution } from './Shell';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { config, explorerName, explorerTemplate } from '../lib/env';
import { dayLabel, formatMb, money } from '../lib/format';
import { useClock, useEnsureChain, useWallet, WrongChainError } from '../lib/hooks';
import { buildProof, type Proof } from '../lib/proof';
import { claimGiftBySignature, reclaimGift, redeemPin } from '../lib/redeem';
import { isUserRejection } from '../lib/wallet';

const errText = (t: ReturnType<typeof useLang>['t'], e: unknown) =>
  e instanceof WrongChainError
    ? t('wallet.switchNeeded', { network: e.chainName })
    : t(errorKey(e instanceof ApiError ? e.code : 'network'));

/** `/gift/claim` — sign GiftClaim with the named wallet (no payment), or enter the PIN from the pass. */
export function ClaimGift({ giftId, name }: { giftId?: string; name?: string }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const { wallet } = useWallet('recipient');
  const ensureChain = useEnsureChain();
  const { openConnectModal } = useConnectModal();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string>();
  const [status, setStatus] = useState<string>();
  // a failed claim's proof; a served one travels to /plan with the issued facts (lib/redeem.ts)
  const [proof, setProof] = useState<Proof>();
  const [working, setWorking] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setWorking(true);
    setStatus(undefined);
    setProof(undefined);
    try {
      router.push(planHref(await fn()));
    } catch (e) {
      if (!isUserRejection(e)) {
        setStatus(errText(t, e));
        setProof(buildProof({ error: e, ...(name ? { ens: { name } } : {}) }));
      }
      setWorking(false);
    }
  };

  return (
    <section className="sheet" aria-labelledby="claim-title">
      <h1 id="claim-title" className="sheet__title" lang={lang}>
        {t('gift.claimTitle')}
      </h1>
      <Caution k="warn.thisBrowser" />
      {giftId && name ? (
        <>
          <p lang={lang}>{t('gift.claimSign')}</p>
          <Button
            block
            disabled={working}
            onClick={() => {
              if (!wallet) openConnectModal?.();
              else
                void run(async () =>
                  claimGiftBySignature(
                    await ensureChain(wallet, config.chainId),
                    giftId as Hex,
                    name,
                  ),
                );
            }}
            data-testid="claim-by-signature"
          >
            {wallet ? `${t('gift.claimButton')} · ${name}` : t('wallet.connectToClaim')}
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
        <PinField
          label={t('gift.claimPin')}
          value={pin}
          onChange={setPin}
          error={pinError}
          testId="gift-pin"
        />
        <Button type="submit" variant="secondary" disabled={working}>
          {t('gift.claimButton')}
        </Button>
      </form>
      <p className="note" role="status" lang={lang}>
        {status ?? ' '}
      </p>
      <ProofPanel proof={proof} />
    </section>
  );
}

/** Reclaim (D-7): after claimBy the payer signs GiftReclaim and the treasury refunds the USDC. */
export function ReclaimGift({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t, lang } = useLang();
  const now = useClock(30_000);
  const { wallet } = useWallet('human');
  const ensureChain = useEnsureChain();
  const { openConnectModal } = useConnectModal();
  const [gifts, setGifts] = useState<SentGift[]>([]);
  const [done, setDone] = useState<Record<string, GiftReclaimResponse>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [proofs, setProofs] = useState<Record<string, Proof>>({});

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
          const refundTx = refunded
            ? explorerTemplate(refunded.network)?.replace('{hash}', refunded.tx)
            : undefined;
          const xName = explorerName(refunded?.network);
          return (
            <li key={g.giftId} data-testid="reclaim-row">
              <span>
                {g.name} · {formatMb(g.mb)} · {dayLabel(g.claimBy, lang)}
              </span>
              {refunded ? (
                <Receipt
                  heading={t('gift.reclaimed', { amount: money(refunded.refundedUsd6) })}
                  you={money(refunded.refundedUsd6)}
                  networkFee={money(refunded.feeUsd6)}
                  lang={lang}
                />
              ) : (
                <Button
                  variant="secondary"
                  disabled={!open}
                  onClick={() => {
                    if (!wallet) {
                      openConnectModal?.();
                      return;
                    }
                    ensureChain(wallet, config.chainId)
                      .then((payer) => reclaimGift(payer, g.giftId as Hex))
                      .then(
                        (r) => {
                          setDone((d) => ({ ...d, [g.giftId]: r }));
                          setProofs((p) => ({ ...p, [g.giftId]: buildProof({ response: r }) }));
                        },
                        (e: unknown) => {
                          setErrors((x) => ({ ...x, [g.giftId]: errText(t, e) }));
                          setProofs((p) => ({ ...p, [g.giftId]: buildProof({ error: e }) }));
                        },
                      );
                  }}
                >
                  {!open
                    ? t('gift.reclaimTooEarly')
                    : wallet
                      ? t('gift.reclaimButton')
                      : t('wallet.connectToReclaim')}
                </Button>
              )}
              {refunded ? (
                <Hash
                  value={refunded.tx}
                  kind="refund transaction"
                  {...(refundTx ? { explorerHref: refundTx } : {})}
                  {...(xName ? { explorerName: xName } : {})}
                  lang={lang}
                />
              ) : null}
              {errors[g.giftId] ? <span className="note">{errors[g.giftId]}</span> : null}
              <ProofPanel
                proof={proofs[g.giftId]}
                fallback={refunded ? <ProofRows receipt={refunded.receipt} /> : null}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
