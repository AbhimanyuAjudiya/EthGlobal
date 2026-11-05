'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react';

import { Button } from './Button';
import { Coupon, type CouponProps } from './Coupon';
import { RUB_HERE, RUB_HERE_LANGS } from './strings';

export interface ScratchCardProps extends Omit<
  CouponProps,
  'pin' | 'pinCover' | 'pinConcealed' | 'variant'
> {
  /** The PIN under the latex. It is rendered from the start; the latex only covers it. */
  pin: string;
  /** Controlled reveal (e.g. the PIN arrived by the stub's own QR). */
  revealed?: boolean;
  /** Fires once, when the latex is cleared past `threshold` or the Reveal PIN button is used. */
  onReveal?: () => void;
  /** Fraction of latex that must be cleared before the rest fades (design-references §5: 45 %). */
  threshold?: number;
  /** Brush radius in CSS px (§5: 24). */
  brushRadius?: number;
}

const REDUCED = '(prefers-reduced-motion: reduce)';

const noop = () => undefined;

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return noop;
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const readReduced = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(REDUCED).matches;

/** True when the viewer asked for reduced motion; false on the server. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, () => false);
}

/** Share of fully cleared pixels, sampled on a coarse grid so a move event stays cheap. */
function clearedFraction(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const { data } = ctx.getImageData(0, 0, width, height);
  const step = 8;
  let total = 0;
  let clear = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      total += 1;
      if ((data[(y * width + x) * 4 + 3] ?? 255) === 0) clear += 1;
    }
  }
  return total === 0 ? 0 : clear / total;
}

function vibrate(ms: number) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
  }
}

interface LatexProps {
  brushRadius: number;
  threshold: number;
  onCleared: () => void;
  canScratch: boolean;
}

/**
 * The silver latex over the PIN panel. A canvas tracks the finger 1:1 with `destination-out`; when canvas
 * or motion is unavailable it is a plain latex block that only the Reveal PIN button removes.
 */
function Latex({ brushRadius, threshold, onCleared, canScratch }: LatexProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const tenths = useRef(0);
  const scratched = useRef(false);
  const done = useRef(false);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ink = inkRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ink || !ctx || scratched.current) return false;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const latex = getComputedStyle(canvas).color;
    const inkStyle = getComputedStyle(ink);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = latex;
    ctx.fillRect(0, 0, width, height);
    // Foil grain: a few hundred specks of the ink colour at low alpha; deterministic, no gradient.
    ctx.fillStyle = inkStyle.color;
    let seed = 7;
    for (let i = 0; i < Math.round((width * height) / 40); i += 1) {
      seed = (seed * 16807) % 2147483647;
      const x = (seed % 10_000) / 10_000;
      seed = (seed * 16807) % 2147483647;
      const y = (seed % 10_000) / 10_000;
      ctx.globalAlpha = 0.05 + (seed % 7) / 100;
      ctx.fillRect(x * width, y * height, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.font = `${inkStyle.fontWeight} ${inkStyle.fontSize} ${inkStyle.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RUB_HERE, width / 2, height / 2);
    return true;
  }, []);

  useEffect(() => {
    if (!canScratch) return;
    // First paint on the next frame, once layout has sized the panel; repaint when the faces load.
    const frame = requestAnimationFrame(() => {
      if (paint()) setReady(true);
    });
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    let live = true;
    void fonts?.ready.then(() => {
      if (live) paint();
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [canScratch, paint]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const scratch = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || done.current) return;
    const to = point(event);
    const from = last.current ?? to;
    scratched.current = true;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushRadius * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    last.current = to;
    const fraction = clearedFraction(ctx, canvas.width, canvas.height);
    const reached = Math.floor(fraction * 10);
    if (reached > tenths.current) {
      tenths.current = reached;
      vibrate(10);
    }
    if (fraction >= threshold) {
      done.current = true;
      onCleared();
    }
  };

  return (
    <div className="scratch__latex" data-mode={ready ? 'canvas' : 'block'} aria-hidden="true">
      <span className="scratch__rub" ref={inkRef}>
        <span lang="en">{RUB_HERE_LANGS.en}</span> · <span lang="hi">{RUB_HERE_LANGS.hi}</span>
      </span>
      {canScratch ? (
        <canvas
          ref={canvasRef}
          className="scratch__canvas"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            last.current = null;
            scratch(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 0 || event.pointerType === 'touch') scratch(event);
          }}
          onPointerUp={() => {
            last.current = null;
          }}
          onPointerCancel={() => {
            last.current = null;
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The coupon under silver latex. Drag to scratch (finger-tracked, 24 px brush); past 45 % the rest fades
 * in --duration-state with --ease-exit. "Reveal PIN" is the keyboard and reduced-motion twin (100 ms).
 */
export function ScratchCard({
  pin,
  revealed,
  onReveal,
  threshold = 0.45,
  brushRadius = 24,
  ...coupon
}: ScratchCardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [own, setOwn] = useState<'covered' | 'scratched' | 'button'>('covered');
  const isRevealed = revealed ?? own !== 'covered';
  const announced = useRef(false);

  const reveal = useCallback(
    (via: 'scratched' | 'button') => {
      setOwn((current) => (current === 'covered' ? via : current));
      if (!announced.current) {
        announced.current = true;
        onReveal?.();
      }
    },
    [onReveal],
  );

  const via = own === 'covered' ? 'prop' : own;

  return (
    <div className="scratch" data-revealed={isRevealed || undefined} data-via={via}>
      <Coupon
        {...coupon}
        pin={pin}
        variant="screen"
        pinConcealed={!isRevealed}
        pinCover={
          <Latex
            brushRadius={brushRadius}
            threshold={threshold}
            canScratch={!reducedMotion}
            onCleared={() => reveal('scratched')}
          />
        }
      />
      <div className="scratch__actions">
        {isRevealed ? null : (
          <Button variant="secondary" onClick={() => reveal('button')}>
            Reveal PIN
          </Button>
        )}
        <p className="scratch__status" role="status">
          {isRevealed ? 'PIN revealed' : ''}
        </p>
      </div>
    </div>
  );
}
