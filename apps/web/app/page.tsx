import Link from 'next/link';

import { formatMb, formatUsd6 } from '@ethglobal/protocol/units';
import {
  accentTokens,
  borderTokens,
  leading,
  motion,
  semanticTokens,
  seriesTokens,
  surfaceTokens,
  textTokens,
  typeScale,
  type ColorToken,
  type TypeScaleStep,
} from '@ethglobal/ui';

import { TokenControls } from './token-controls';

import type { CSSProperties } from 'react';

const colourGroups: readonly { title: string; tokens: readonly ColorToken[] }[] = [
  { title: 'Surfaces', tokens: surfaceTokens },
  { title: 'Borders', tokens: borderTokens },
  { title: 'Text', tokens: textTokens },
  { title: 'Accent', tokens: accentTokens },
  { title: 'Semantic', tokens: semanticTokens },
  { title: 'Data-viz series (fixed order)', tokens: seriesTokens },
];

const specimen = {
  display: 'Sphinx of black quartz, judge my vow',
  text: 'Pack my box with five dozen liquor jugs 0123456789',
  amount: '₹1,24,500.00',
  hindi: 'कुल राशि ₹1,24,500.00',
  hash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
};

const displaySteps = typeScale.filter((step) => step >= 20);
const textSteps = typeScale.filter((step) => step <= 16);

/** Inline so the scale stays data-driven; Tailwind cannot see a class name built at render time. */
const stepStyle = (step: TypeScaleStep): CSSProperties => ({
  fontSize: `var(--text-${step})`,
  lineHeight: step >= 20 ? 'var(--leading-display)' : 'var(--leading-text)',
});

const motionRows: readonly [token: string, value: string, use: string][] = [
  ['--duration-micro', `${motion.duration.micro} ms`, 'press, toggle'],
  ['--duration-state', `${motion.duration.state} ms`, 'hover, selection, tab, tooltip'],
  [
    '--duration-spatial-in',
    `${motion.duration.spatialIn} ms`,
    'sheet, drawer, pane, route (enter)',
  ],
  ['--duration-spatial-out', `${motion.duration.spatialOut} ms`, '0.8 × enter'],
  ['--duration-odometer', `≤ ${motion.duration.odometerMax} ms`, 'hero number only'],
  ['--ease-standard', motion.easing.standard, 'everything that enters or changes'],
  ['--ease-exit', motion.easing.exit, 'everything that leaves'],
  [
    '--spring-stiffness / --spring-damping',
    `${motion.spring.stiffness} / ${motion.spring.damping}`,
    'gestures',
  ],
];

function SectionHeading({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-2">
      <h2 id={id} className="font-display text-24 text-ink">
        {title}
      </h2>
      <p className="text-13 text-ink-tertiary">{note}</p>
    </div>
  );
}

function Swatch({ token }: { token: ColorToken }) {
  return (
    <figure className="rounded-md border border-border-subtle bg-surface p-2">
      <div
        className="h-14 rounded-sm border border-border-subtle"
        style={{ background: `var(--${token})` }}
      />
      <figcaption className="mt-2 font-mono text-12 text-ink-secondary">--{token}</figcaption>
    </figure>
  );
}

export default function TokenSheet() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-13 text-ink-tertiary">@ethglobal/ui</p>
          <h1 className="font-display text-44 text-ink">Token sheet</h1>
          <p className="max-w-prose text-16 text-ink-secondary">
            Every token from tokens.css and fonts.css, rendered live. Switch the type pairing and
            theme to inspect them in context. Components in every state:{' '}
            <Link className="text-accent underline" href="/ui">
              /ui component gallery
            </Link>
            .
          </p>
        </div>
        <TokenControls />
      </header>

      <section aria-labelledby="type">
        <SectionHeading
          id="type"
          title="Type scale"
          note={`leading ${leading.display} display · ${leading.text} text · ${leading.devanagari} Devanagari`}
        />
        <ol className="flex flex-col gap-5">
          {displaySteps.map((step) => (
            <li key={step} className="grid grid-cols-[5rem_1fr] items-baseline gap-4">
              <span className="font-mono text-12 text-ink-tertiary">text-{step}</span>
              <span className="font-display text-ink" style={stepStyle(step)}>
                {specimen.display}
              </span>
            </li>
          ))}
          {textSteps.map((step) => (
            <li key={step} className="grid grid-cols-[5rem_1fr] items-baseline gap-4">
              <span className="font-mono text-12 text-ink-tertiary">text-{step}</span>
              <span className="text-ink" style={stepStyle(step)}>
                {specimen.text}
              </span>
            </li>
          ))}
        </ol>
        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-border-subtle bg-surface p-4">
            <dt className="font-mono text-12 text-ink-tertiary">
              tabular-nums · ₹ · {formatUsd6(400_000n, { unit: 'USDC' })} / {formatMb(100)}
            </dt>
            <dd className="mt-2 text-32 text-ink">{specimen.amount}</dd>
          </div>
          <div className="rounded-md border border-border-subtle bg-surface p-4">
            <dt className="font-mono text-12 text-ink-tertiary">
              lang=&quot;hi&quot; · leading 1.6
            </dt>
            <dd lang="hi" className="mt-2 text-20 text-ink">
              {specimen.hindi}
            </dd>
          </div>
          <div className="rounded-md border border-border-subtle bg-surface p-4">
            <dt className="font-mono text-12 text-ink-tertiary">[data-hash] · slashed-zero</dt>
            <dd data-hash className="mt-2 break-all text-14 text-ink">
              {specimen.hash}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="colour">
        <SectionHeading
          id="colour"
          title="Colour"
          note="OKLCH, light-dark(); hue 70–80 neutrals, accent 195"
        />
        <div className="flex flex-col gap-8">
          {colourGroups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-3 text-14 text-ink-secondary">{group.title}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {group.tokens.map((token) => (
                  <Swatch key={token} token={token} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="motion">
        <SectionHeading
          id="motion"
          title="Motion"
          note="transform and opacity only; reduced motion collapses to ≤ 100 ms"
        />
        <table className="w-full text-left text-14">
          <thead className="text-12 text-ink-tertiary">
            <tr>
              <th className="pb-2 font-normal">token</th>
              <th className="pb-2 font-normal">value</th>
              <th className="pb-2 font-normal">use</th>
            </tr>
          </thead>
          <tbody>
            {motionRows.map(([token, value, use]) => (
              <tr key={token} className="border-t border-border-subtle">
                <td className="py-2 pr-4 font-mono text-13 text-ink">{token}</td>
                <td className="py-2 pr-4 font-mono text-13 text-ink-secondary">{value}</td>
                <td className="py-2 text-ink-secondary">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-13 text-ink-tertiary">
          Hover the block: --duration-state with --ease-standard.
        </p>
        <div
          className="mt-2 h-10 w-24 rounded-md bg-accent transition-transform duration-(--duration-state) ease-(--ease-standard) hover:translate-x-6 motion-reduce:transition-none"
          aria-hidden
        />
      </section>
    </main>
  );
}
