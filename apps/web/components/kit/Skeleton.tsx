export interface SkeletonProps {
  shape: 'balance' | 'row' | 'card' | 'text';
  /** For `row`: how many rows. */
  count?: number;
  /** What is loading ("Loading your plan"). */
  label?: string;
}

/** Sunken blocks shaped like the kit piece they stand in for; no shimmer. */
export function Skeleton({ shape, count = 3, label }: SkeletonProps) {
  return (
    <div
      className="kit-skeleton"
      data-shape={shape}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-busy="true"
    >
      {shape === 'balance' ? (
        <>
          <span className="kit-skeleton__bar" data-w="s" />
          <span className="kit-skeleton__bar" data-w="hero" />
          <span className="kit-skeleton__bar" data-w="meter" />
          <span className="kit-skeleton__bar" data-w="m" />
        </>
      ) : shape === 'row' ? (
        Array.from({ length: count }, (_, i) => (
          <span key={i} className="kit-skeleton__row">
            <span className="kit-skeleton__dot" />
            <span className="kit-skeleton__bar" data-w="m" />
          </span>
        ))
      ) : shape === 'text' ? (
        <>
          <span className="kit-skeleton__bar" data-w="l" />
          <span className="kit-skeleton__bar" data-w="m" />
        </>
      ) : null}
    </div>
  );
}
