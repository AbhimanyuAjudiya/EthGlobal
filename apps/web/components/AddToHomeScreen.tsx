'use client';

import { useEffect, useState } from 'react';

import { Button } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { isStandalone, parseDevice } from '../lib/device';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'recharge.a2hs.dismissed';
let deferred: InstallPromptEvent | undefined;

/** Called on `/`: Chrome's beforeinstallprompt is captured and deferred until the plan exists. */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(
    'beforeinstallprompt',
    (event) => {
      event.preventDefault();
      deferred = event as InstallPromptEvent;
    },
    { once: true },
  );
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/**
 * Shown on /plan after the bundle is issued and the odometer has run — never on launch. iOS Safari gets the
 * Share → Add to Home Screen instructions; Chrome gets its deferred install prompt. Dismissal is remembered.
 */
export function AddToHomeScreen({ ready }: { ready: boolean }) {
  const { t, lang } = useLang();
  const [state, setState] = useState<'hidden' | 'ios' | 'prompt' | 'plain'>('hidden');

  useEffect(() => {
    if (!ready || dismissed() || isStandalone(window)) return;
    const device = parseDevice(navigator.userAgent);
    setState(device.os === 'ios' ? 'ios' : deferred ? 'prompt' : 'plain');
  }, [ready]);

  if (state === 'hidden') return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // per-viewer convenience only
    }
    setState('hidden');
  };

  return (
    <section className="sheet-row a2hs" aria-labelledby="a2hs-title" data-testid="add-to-home-screen">
      <p id="a2hs-title" lang={lang}>
        {state === 'ios' ? t('a2hs.ios') : t('a2hs.android')}
      </p>
      {state === 'ios' ? (
        <p className="a2hs__icons" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 3v12" />
            <path d="m8 7 4-4 4 4" />
            <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
          </svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
        </p>
      ) : null}
      <div className="row-actions">
        {state === 'prompt' ? (
          <Button
            variant="secondary"
            onClick={() => {
              void deferred?.prompt();
              deferred = undefined;
              dismiss();
            }}
          >
            {t('a2hs.button')}
          </Button>
        ) : null}
        <Button variant="quiet" onClick={dismiss}>
          {t('a2hs.dismiss')}
        </Button>
      </div>
    </section>
  );
}

/**
 * Asked only on /plan after issue and only in the Home Screen app (iOS 16.4+ Web Push needs it), with the
 * reason stated. Outside standalone it explains why instead of asking. Never on launch.
 */
export function NotificationAsk({ ready }: { ready: boolean }) {
  const { t, lang } = useLang();
  const [standalone, setStandalone] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setStandalone(isStandalone(window));
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  if (!ready) return null;
  if (!standalone)
    return (
      <p className="note" lang={lang} data-testid="notification-needs-home">
        {t('notify.needsHome')}
      </p>
    );
  if (permission === 'granted')
    return (
      <p className="note" lang={lang}>
        {t('notify.granted')}
      </p>
    );
  if (permission === 'denied' || permission === 'unsupported')
    return (
      <p className="note" lang={lang}>
        {t('notify.denied')}
      </p>
    );
  return (
    <section className="sheet-row" data-testid="notification-ask">
      <p lang={lang}>{t('notify.reason')}</p>
      <Button
        variant="secondary"
        onClick={() => {
          void Notification.requestPermission().then(setPermission);
        }}
      >
        {t('notify.button')}
      </Button>
    </section>
  );
}
