'use client';

import { useEffect, useState } from 'react';

import { dateTime, DEFAULT_TIME_ZONE, duration } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A clock that re-renders once a minute, and once a second only in the last hour. When `now` is passed
 * the caller owns time (tests, the gallery, server renders) and nothing ticks.
 */
export function useNow(until: number, now?: number): number {
  const [tick, setTick] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const left = until - Date.now();
    if (left <= 0) return;
    const step = left < HOUR ? 1000 : MINUTE;
    const timer = setTimeout(() => setTick(Date.now()), step - (Date.now() % step));
    return () => clearTimeout(timer);
  }, [until, now, tick]);
  return now ?? tick;
}

export interface CountdownProps {
  /** The deadline as read from the protocol (the escrow's claimBy, the entity's expiresAt), ms. */
  until: number;
  now?: number;
  timeZone?: string;
  /** "Claim within" → "Claim within 6 d 22 h · until Sun 15 Nov 09:12 IST". */
  lead: string;
  /** Shown once the deadline has passed: "Claim window closed". */
  ended: string;
  className?: string;
}

/** Relative and absolute together, as text; a <time datetime> that screen readers do not re-announce. */
export function Countdown({
  until,
  now,
  timeZone = DEFAULT_TIME_ZONE,
  lead,
  ended,
  className,
}: CountdownProps) {
  const current = useNow(until, now);
  const left = until - current;
  const absolute = dateTime(until, timeZone);
  return (
    <time
      className={className}
      dateTime={new Date(until).toISOString()}
      aria-live="off"
      data-ended={left <= 0 ? true : undefined}
      suppressHydrationWarning
    >
      {left > 0 ? `${lead} ${duration(left)} · until ${absolute}` : `${ended} · ${absolute}`}
    </time>
  );
}
