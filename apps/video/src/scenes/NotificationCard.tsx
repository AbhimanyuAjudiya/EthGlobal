/**
 * The push copy as a card in the product's own language (not a redrawn iOS banner: the real lock screen is
 * always a REAL capture). Used as the reference inside a placeholder slate and as a still for posts.
 */
import { v } from '../theme';

import { useEntry } from './Receipt';

export interface NotificationProps {
  app?: string;
  title: string;
  body: string;
  time: string;
  enterAt?: number;
}

export function NotificationCard({ app = 'Recharge', title, body, time, enterAt = 0 }: NotificationProps) {
  const entry = useEntry(enterAt);
  return (
    <div
      style={{
        ...entry,
        background: v.raised,
        border: `1px solid ${v.borderSubtle}`,
        borderRadius: 12,
        padding: '12px 14px',
        color: v.text,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: v.textSecondary,
        }}
      >
        <span style={{ fontVariationSettings: "'wdth' 100, 'wght' 600" }}>{app}</span>
        <span className="mono">{time}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 16, fontVariationSettings: "'wdth' 100, 'wght' 600" }}>
        {title}
      </div>
      <div style={{ marginTop: 2, fontSize: 14 }}>{body}</div>
    </div>
  );
}
