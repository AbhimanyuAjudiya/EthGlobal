'use client';

import { useEffect } from 'react';

/** Registers /sw.js (app shell only; never caches /claim, /esim/*, /card/*, /me/*, /gift/* — T-61). */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
