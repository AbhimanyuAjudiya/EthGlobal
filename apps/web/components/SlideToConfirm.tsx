'use client';

import { useId, useRef, useState } from 'react';

const STEP = 10;
/** A slide, not a value: at least this many separate moves… */
const MIN_MOVES = 3;
/** …over at least this long, in one pointer or keyboard interaction (RT-W-04). */
const MIN_MS = 300;
const JUMPS = new Set(['Home', 'End', 'PageUp', 'PageDown']);

interface Gesture {
  start: number;
  moves: number;
}

/**
 * Slide-to-confirm for an irreversible money move (design-foundations §2.10). A native range input, so it works
 * by finger, mouse and keyboard, but it confirms a GESTURE, not a value (RT-W-04, T-72): the thumb must reach the
 * end through ≥ 3 moves spanning ≥ 300 ms, then the move fires on RELEASE ("Release to pause"). Home / End /
 * PageUp / PageDown do nothing and the arrows step 10 %, so the keyboard path is ten deliberate presses; a click
 * on the end of the track is one move and resets on release.
 */
export function SlideToConfirm({
  label,
  releaseLabel,
  onConfirm,
  disabled = false,
}: {
  label: string;
  /** Shown while the thumb sits at the end: "Release to pause". */
  releaseLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [value, setValue] = useState(0);
  const gesture = useRef<Gesture | undefined>(undefined);
  const armed = value >= 100;

  const begin = () => {
    gesture.current ??= { start: performance.now(), moves: 0 };
  };
  const reset = () => {
    gesture.current = undefined;
    setValue(0);
  };
  const slid = () => {
    const g = gesture.current;
    return g !== undefined && g.moves >= MIN_MOVES && performance.now() - g.start >= MIN_MS;
  };
  /** Pointer up ends the gesture: it fires only from the end of a real slide, and the thumb always returns. */
  const pointerUp = () => {
    const fire = armed && slid();
    reset();
    if (fire) onConfirm();
  };
  /** Key up keeps the keyboard's progress; only the release at the end, after a real sequence, fires. */
  const keyUp = () => {
    if (!armed || !slid()) return;
    reset();
    onConfirm();
  };

  return (
    <div
      className="slide-confirm"
      data-disabled={disabled || undefined}
      data-armed={armed || undefined}
    >
      <label htmlFor={id} className="slide-confirm__label">
        {armed ? releaseLabel : label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={STEP}
        value={value}
        disabled={disabled}
        aria-describedby={hintId}
        aria-valuetext={armed ? releaseLabel : `${value} %`}
        onPointerDown={() => {
          gesture.current = { start: performance.now(), moves: 0 };
        }}
        onKeyDown={(e) => {
          if (JUMPS.has(e.key)) {
            e.preventDefault();
            return;
          }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            reset();
            return;
          }
          begin();
        }}
        onChange={(e) => {
          begin();
          if (gesture.current) gesture.current.moves += 1;
          setValue(Math.min(100, Math.max(0, Number(e.target.value))));
        }}
        onPointerUp={pointerUp}
        onPointerCancel={reset}
        onKeyUp={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') keyUp();
        }}
        onBlur={reset}
        data-testid="slide-to-confirm"
      />
      <p id={hintId} className="slide-confirm__hint">
        Drag to the end, or press → ten times, then let go.
      </p>
    </div>
  );
}
