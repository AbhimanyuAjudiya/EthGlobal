'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { GiftReclaimResponse } from '@ethglobal/protocol/schemas';
import { Hash, Receipt } from '@ethglobal/ui/components';

import { sentGifts, type SentGift } from './GiftForm';
import { ProofRows } from './IssuingRows';
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
  Section,
  Sheet,
} from './kit';
import { PinField } from './PinField';
import { ProofPanel } from './ProofPanel';
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
export function ClaimGift(props: { giftId?: string; name?: string }) {
  const { t, lang } = useLang();
  // /gift/claim?id=&name= when rendered by the route itself (not through ClaimRoute's props)
  const search = useSearchParams();
  const id = props.giftId ?? search.get('id') ?? undefined;
  const giftId = id && /^0x[0-9a-f]{64}$/i.test(id) ? id : undefined;
  const name = props.name ?? search.get('name') ?? undefined;
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

  const bySignature = Boolean(giftId && name);
  const claimSigned = () => {
    if (!wallet) openConnectModal?.();
    else if (giftId && name)
      void run(async () =>
        claimGiftBySignature(await ensureChain(wallet, config.chainId), giftId as Hex, name),
      );
  };

  return (
    <>
      <PageHeader id="claim-title" title={t('gift.claimTitle')} lang={lang} />
      {bySignature ? (
        <Card lang={lang}>
          <ListGroup flush label={t('gift.claimSign')}>
            <ListRow
              leading={<Avatar icon="wallet" />}
              title={t('gift.claimSign')}
              subtitle={name}
            />
          </ListGroup>
        </Card>
      ) : null}
      <Card padded={false} lang={lang}>
        <form
          id="claim-pin"
          className="card--padded"
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
          {bySignature ? (
            <Button type="submit" variant="secondary" block disabled={working}>
              {t('gift.claimButton')}
            </Button>
          ) : null}
        </form>
      </Card>
      {status ? (
        <Notice tone="negative" role="status" lang={lang}>
          {status}
        </Notice>
      ) : null}
      <Notice tone="warning" lang={lang}>
        {t('warn.thisBrowser')}
      </Notice>
      <ProofPanel proof={proof} />
      <ActionBar>
        {bySignature ? (
          <Button
            block
            size="lg"
            disabled={working}
            onClick={claimSigned}
            data-testid="claim-by-signature"
          >
            {wallet ? `${t('gift.claimButton')} · ${name}` : t('wallet.connectToClaim')}
          </Button>
        ) : (
          <Button type="submit" form="claim-pin" block size="lg" disabled={working}>
            {t('gift.claimButton')}
          </Button>
        )}
      </ActionBar>
    </>
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
  const [opened, setOpened] = useState<string>();

  useEffect(() => {
    void sentGifts.list().then(setGifts);
  }, [refreshKey]);

  if (gifts.length === 0) return null;
  const openGift = gifts.find((g) => g.giftId === opened);
  const refunded = openGift ? done[openGift.giftId] : undefined;
  const refundTx = refunded
    ? explorerTemplate(refunded.network)?.replace('{hash}', refunded.tx)
    : undefined;
  const xName = explorerName(refunded?.network);
  return (
    <Section title={t('gift.reclaimTitle')} lang={lang}>
      <ListGroup label={t('gift.reclaimTitle')} data-testid="reclaim">
        {gifts.map((g) => {
          const back = done[g.giftId];
          const open = now >= g.claimBy;
          return (
            <ListRow
              key={g.giftId}
              data-testid="reclaim-row"
              leading={<Avatar label={g.name} />}
              title={`${g.name} · ${formatMb(g.mb)}`}
              subtitle={errors[g.giftId] ?? dayLabel(g.claimBy, lang)}
              {...(back
                ? {
                    onClick: () => setOpened(g.giftId),
                    trailing: (
                      <Pill tone="positive">
                        {t('gift.reclaimed', { amount: money(back.refundedUsd6) })}
                      </Pill>
                    ),
                  }
                : {
                    trailing: (
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
                                setProofs((p) => ({
                                  ...p,
                                  [g.giftId]: buildProof({ response: r }),
                                }));
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
                    ),
                  })}
            />
          );
        })}
      </ListGroup>
      {gifts
        .filter((g) => !done[g.giftId] && proofs[g.giftId])
        .map((g) => (
          <ProofPanel key={g.giftId} proof={proofs[g.giftId]} />
        ))}
      <Sheet
        open={refunded !== undefined}
        onClose={() => setOpened(undefined)}
        title={t('gift.reclaimTitle')}
      >
        {openGift && refunded ? (
          <>
            <Receipt
              heading={t('gift.reclaimed', { amount: money(refunded.refundedUsd6) })}
              you={money(refunded.refundedUsd6)}
              networkFee={money(refunded.feeUsd6)}
              lang={lang}
            />
            <ListGroup flush label={t('receipts.details')}>
              <ListRow
                title={t('receipts.rowTx')}
                value={
                  <Hash
                    value={refunded.tx}
                    kind="refund transaction"
                    {...(refundTx ? { explorerHref: refundTx } : {})}
                    {...(xName ? { explorerName: xName } : {})}
                    lang={lang}
                  />
                }
              />
            </ListGroup>
            <ProofPanel
              proof={proofs[openGift.giftId]}
              fallback={<ProofRows receipt={refunded.receipt} />}
            />
          </>
        ) : null}
      </Sheet>
    </Section>
  );
}
