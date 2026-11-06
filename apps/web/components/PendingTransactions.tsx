'use client';

import { useEffect, useState } from 'react';

import { Button, Hash } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { explorerTemplate, networkName } from '../lib/env';
import { useEnsureChain, useWallet } from '../lib/hooks';
import { pending, type PendingTx } from '../lib/store';
import { followTransaction } from '../lib/use-onchain';

/** Saved broadcasts survive reloads; checking a hash never sends another transaction. */
export function PendingTransactions() {
  const { t, lang } = useLang();
  const { wallet } = useWallet('human');
  const ensureChain = useEnsureChain();
  const [transactions, setTransactions] = useState<PendingTx[]>([]);
  const [checking, setChecking] = useState<string>();
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    let alive = true;
    const read = () => void pending.list().then((rows) => alive && setTransactions(rows));
    read();
    const timer = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!transactions.length) return null;
  const check = async (tx: PendingTx) => {
    if (!wallet || checking) return;
    setChecking(tx.hash);
    setMessage(undefined);
    try {
      const reader = tx.network.startsWith('eip155:')
        ? (await ensureChain(wallet, Number(tx.network.slice(7)))).reader
        : undefined;
      const outcome = await followTransaction({ ...tx, reader, dispatch: () => undefined });
      setMessage(
        outcome === 'pending'
          ? t('pending.still')
          : outcome === 'finalized'
            ? t('pending.confirmed')
            : t('pending.reverted'),
      );
      setTransactions(await pending.list());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('pending.failed'));
    } finally {
      setChecking(undefined);
    }
  };
  return (
    <section className="pane" aria-label={t('pending.title')} lang={lang}>
      <h2 className="pane__title">{t('pending.title')}</h2>
      <p className="note">{t('pending.intro')}</p>
      {transactions.map((tx) => (
        <div className="sheet-row" key={tx.hash}>
          <p>
            {tx.label} · {networkName(tx.network)}
          </p>
          <Hash
            value={tx.hash}
            kind="transaction hash"
            {...(explorerTemplate(tx.network)
              ? { explorerHref: explorerTemplate(tx.network)!.replace('{hash}', tx.hash) }
              : {})}
          />
          <Button
            variant="secondary"
            disabled={!wallet || Boolean(checking)}
            onClick={() => void check(tx)}
          >
            {t(checking === tx.hash ? 'pending.checking' : 'pending.check')}
          </Button>
        </div>
      ))}
      {!wallet ? <p className="note">{t('pending.connect')}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
