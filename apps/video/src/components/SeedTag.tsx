/**
 * Frames that show hashes, keys, addresses or PINs from the local stack (headless captures) or from the seed say
 * so, in-frame, until src/seed/saturday.json is flipped to the rehearsal's real values — so a placeholder value
 * can never be posted as a record.
 */
import { seedLabelled } from '../seed';
import { v } from '../theme';
import { usePaneSize } from './pane';

export const SEED_LABEL = 'SEED DATA · not a real record';

export function SeedTag({ source = 'local-stack capture' }: { source?: string }) {
  const { width, height } = usePaneSize();
  if (!seedLabelled()) return null;
  const unit = Math.min(width, height) / 1080;
  return (
    <div
      className="mono"
      style={{
        position: 'absolute',
        left: 64 * unit,
        // Portrait: just above the lower-caption band (y ≈ 1380), clear of captions and platform chrome.
        bottom: (height > width ? 560 : 48) * unit,
        fontSize: 24 * unit,
        padding: `${8 * unit}px ${12 * unit}px`,
        color: v.text,
        background: v.sunken,
        border: `${Math.max(1, 2 * unit)}px dashed ${v.borderStrong}`,
        zIndex: 10,
      }}
    >
      {SEED_LABEL} · {source}
    </div>
  );
}
