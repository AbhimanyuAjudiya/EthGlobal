'use client';

import { useState } from 'react';

import { Button } from '@ethglobal/ui/components';

import { QrCode } from './QrCode';
import { useLang } from '../i18n/lang';
import { isHandheld } from '../lib/device';

import type { HashPackSession } from '../lib/hedera-wc';

export interface HashPackState {
  uri?: string;
  link?: string;
  session?: HashPackSession;
  failed?: boolean;
  connecting?: boolean;
}

/** The same native wallet pairing for purchases, top-ups and message-authorized cancellation. */
export function HashPackConnection({
  state,
  onConnect,
  connectLabel,
}: {
  state: HashPackState;
  onConnect: () => void;
  connectLabel?: string;
}) {
  const { t, lang } = useLang();
  const [copiedUri, setCopiedUri] = useState<string>();
  const [copyFailed, setCopyFailed] = useState(false);
  const handheld = typeof window !== 'undefined' && isHandheld(window);
  const copy = async () => {
    if (!state.uri) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(state.uri);
      setCopiedUri(state.uri);
    } catch {
      setCopyFailed(true);
    }
  };
  return (
    <div lang={lang}>
      {state.session ? (
        <>
          <p className="note" data-testid="hashpack-account">
            {t('pay.hashpackAccount', { account: state.session.accountId })}
          </p>
          <Button variant="quiet" onClick={onConnect} disabled={state.connecting}>
            {t('pay.hashpackReconnect')}
          </Button>
        </>
      ) : state.uri ? (
        <>
          <p className="note">{t('pay.hashpackScan')}</p>
          <QrCode url={state.uri} label={t('pay.hashpackScan')} sizeMm={48} />
          <Button variant="secondary" onClick={() => void copy()}>
            {copiedUri === state.uri ? t('pay.hashpackCopied') : t('pay.hashpackCopy')}
          </Button>
          {copyFailed ? (
            <p className="note" role="status">
              {t('pay.hashpackCopyFailed')}
            </p>
          ) : null}
        </>
      ) : (
        <Button
          block
          onClick={onConnect}
          disabled={state.connecting}
          data-testid="hashpack-connect"
        >
          {connectLabel ?? t('pay.hashpackConnect')}
        </Button>
      )}
      {handheld && state.link ? (
        <a className="ui-button ui-button--block" data-variant="secondary" href={state.link}>
          {t('pay.hashpackOpen')}
        </a>
      ) : null}
      {state.failed ? (
        <p className="note" role="alert">
          {t('pay.hashpackFailed')}
        </p>
      ) : null}
    </div>
  );
}
