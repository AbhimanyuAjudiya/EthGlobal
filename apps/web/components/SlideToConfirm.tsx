'use client';

import { useId, useState } from 'react';

/**
 * Slide-to-confirm for an irreversible money move (design-foundations §2.10). A native range input, so it
 * works by finger, mouse and keyboard (arrow / End); reaching the end fires once, then it resets.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  disabled = false,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(0);
  return (
    <div className="slide-confirm" data-disabled={disabled || undefined}>
      <label htmlFor={id} className="slide-confirm__label">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-valuetext={value >= 100 ? 'confirmed' : `${value} %`}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (next >= 100) {
            setValue(0);
            onConfirm();
          } else setValue(next);
        }}
        onPointerUp={() => setValue((v) => (v >= 100 ? v : 0))}
        data-testid="slide-to-confirm"
      />
    </div>
  );
}
