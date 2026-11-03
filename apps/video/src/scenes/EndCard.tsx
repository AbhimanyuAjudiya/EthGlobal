/**
 * The ending (SCRIPTS.md §7 #9): one line and the name, on paper. Nothing else, no motion.
 * `portrait` for the shorts (Anek 64 px, wdth 110 / wght 700); `landscape` for the judge video, which adds the
 * disclosure line, the live endpoint and the repo in Chivo Mono.
 */
import { AbsoluteFill } from 'remotion';

import { safe, v } from '../theme';

import { Title } from './Title';

export interface EndCardProps {
  line: string;
  wordmark?: string;
  theme?: 'light' | 'dark';
}

export function EndCard({ line, wordmark = 'Recharge' }: EndCardProps) {
  return (
    <AbsoluteFill
      style={{
        background: v.canvas,
        padding: `0 ${safe.x}px`,
        justifyContent: 'center',
        paddingBottom: safe.bottom - safe.top,
      }}
    >
      <Title size={64} style={{ maxWidth: safe.maxWidth }}>
        {line}
      </Title>
      <Title size={40} style={{ marginTop: 40, color: v.textSecondary }}>
        {wordmark}
      </Title>
    </AbsoluteFill>
  );
}

/** Judge-video end card; `scale` is the judge layout's px multiplier (see compositions/JudgeVideo.tsx). */
export function EndCardLandscape({
  disclosure,
  endpoint,
  repo,
  scale,
  wordmark = 'Recharge',
}: {
  disclosure: string;
  endpoint: string;
  repo: string;
  scale: number;
  wordmark?: string;
}) {
  return (
    <AbsoluteFill
      style={{ background: v.canvas, padding: 120, justifyContent: 'center', gap: 24 * scale }}
    >
      <Title size={64 * scale}>{wordmark}</Title>
      <div className="mono" style={{ fontSize: 16 * scale, display: 'flex', gap: 24 * scale }}>
        <span>{endpoint}</span>
        <span>{repo}</span>
      </div>
      <div style={{ fontSize: 14 * scale, color: v.textSecondary, maxWidth: 1500 }}>
        {disclosure}
      </div>
    </AbsoluteFill>
  );
}
