'use client';

import { useState } from 'react';

import { Avatar, Button, ButtonLink, ListGroup, ListRow, Notice } from './kit';
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
  const { t } = useLang();
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
    <>
      {state.session ? (
        <ListGroup flush label="HashPack">
          <ListRow
            leading={<Avatar icon="wallet" tone="positive" />}
            title={
              <span data-testid="hashpack-account">
                {t('pay.hashpackAccount', { account: state.session.accountId })}
              </span>
            }
            trailing={
              <Button variant="quiet" onClick={onConnect} disabled={state.connecting}>
                {t('pay.hashpackReconnect')}
              </Button>
            }
          />
        </ListGroup>
      ) : state.uri ? (
        <>
          <Notice tone="info">{t('pay.hashpackScan')}</Notice>
          <QrCode url={state.uri} label={t('pay.hashpackScan')} sizeMm={48} />
          <Button variant="secondary" block onClick={() => void copy()}>
            {copiedUri === state.uri ? t('pay.hashpackCopied') : t('pay.hashpackCopy')}
          </Button>
          {copyFailed ? (
            <Notice tone="warning" role="status">
              {t('pay.hashpackCopyFailed')}
            </Notice>
          ) : null}
        </>
      ) : (
        <Button
          block
          variant="secondary"
          onClick={onConnect}
          disabled={state.connecting}
          data-testid="hashpack-connect"
        >
          {connectLabel ?? t('pay.hashpackConnect')}
        </Button>
      )}
      {handheld && state.link ? (
        <ButtonLink href={state.link} variant="secondary" block native>
          {t('pay.hashpackOpen')}
        </ButtonLink>
      ) : null}
      {state.failed ? (
        <Notice tone="negative" role="alert">
          {t('pay.hashpackFailed')}
        </Notice>
      ) : null}
    </>
  );
}
