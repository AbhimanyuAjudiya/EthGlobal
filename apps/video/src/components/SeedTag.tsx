/**
 * Rendered shots are seeded with real hashes from the rehearsal (SCRIPTS.md §1 "Legend"). Until the seed is
 * replaced, every frame that shows seeded values says so, in-frame, so a placeholder value can never be
 * posted as a record.
 */
import { seed } from '../seed';
import { v } from '../theme';
import { usePaneSize } from './pane';

export function SeedTag() {
  const { width, height } = usePaneSize();
  if (seed.provenance !== 'placeholder') return null;
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
      SEED DATA · not a real record · replace with rehearsal values
    </div>
  );
}
