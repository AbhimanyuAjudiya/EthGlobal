'use client';

import { useState } from 'react';

import { Button } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { isStandalone, parseDevice } from '../lib/device';
import { useHydrated } from '../lib/hooks';

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
  const hydrated = useHydrated();
  const [closed, setClosed] = useState(false);
  const state: 'hidden' | 'ios' | 'prompt' | 'plain' =
    !ready || !hydrated || closed || dismissed() || isStandalone(window)
      ? 'hidden'
      : parseDevice(navigator.userAgent).os === 'ios'
        ? 'ios'
        : deferred
          ? 'prompt'
          : 'plain';

  if (state === 'hidden') return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // per-viewer convenience only
    }
    setClosed(true);
  };

  return (
    <section
      className="sheet-row a2hs"
      aria-labelledby="a2hs-title"
      data-testid="add-to-home-screen"
    >
      <p id="a2hs-title" lang={lang}>
        {state === 'ios' ? t('a2hs.ios') : t('a2hs.android')}
      </p>
      {state === 'ios' ? (
        <p className="a2hs__icons" aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 3v12" />
            <path d="m8 7 4-4 4 4" />
            <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
          </svg>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
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

/** Background push delivery is not configured; permission alone cannot enable alerts. */
export function NotificationAsk({ ready }: { ready: boolean }) {
  const { t, lang } = useLang();
  return ready ? (
    <p className="note" lang={lang} data-testid="notification-unavailable">
      {t('notify.unavailable')}
    </p>
  ) : null;
}
