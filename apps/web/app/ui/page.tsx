import Link from 'next/link';

import {
  BoardingPass,
  Button,
  Coupon,
  Field,
  MbMeter,
  OnchainAction,
  Receipt,
  UsageAsOf,
  type OnchainActionProps,
} from '@ethglobal/ui/components';

import { ScratchDemo } from './demos';
import { CLAIM_BY, HASH, HASHSCAN, HOST, NOW, PINS, REPLACEMENT_HASH, serialFor } from './fixtures';
import { renderQrSlot } from './qr-slot';

import type { ReactNode } from 'react';

/** One state, rendered side by side in both palettes via `color-scheme` on each pane. */
function State({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <figure className="m-0 grid gap-2 border-t border-border-subtle pt-3">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 font-mono text-12 text-ink-tertiary">
        <span className="text-ink-secondary">{name}</span>
        {note ? <span>{note}</span> : null}
      </figcaption>
      <div className="grid gap-3 md:grid-cols-2">
        {(['light', 'dark'] as const).map((scheme) => (
          <div
            key={scheme}
            className="min-w-0 overflow-x-auto rounded-sm border border-border-subtle bg-canvas p-4 text-ink"
            data-color-scheme={scheme}
          >
            <p className="m-0 mb-3 font-mono text-11 text-ink-tertiary">{scheme}</p>
            {children}
          </div>
        ))}
      </div>
    </figure>
  );
}

function Group({
  id,
  title,
  source,
  children,
}: {
  id: string;
  title: string;
  source: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="m-0 font-mono text-16 text-ink">
          {title}
        </h2>
        <p className="m-0 font-mono text-12 text-ink-tertiary">{source}</p>
      </div>
      {children}
    </section>
  );
}

const review = [
  { label: 'Valid', value: 'with your plan until Sun 15 Nov 09:12' },
  { label: 'Pay from', value: 'Hedera · 3.10 USDC' },
  { label: 'Network fee', value: '$0.00 — paid by the facilitator' },
];
const sheet = {
  title: 'Add 100 MB · $0.40',
  review,
  worstCase: 'Worst case: if settlement fails you pay nothing. This approval expires in 5:00',
  network: 'Hedera',
  explorerUrl: HASHSCAN,
  explorerName: 'HashScan',
} as const;

const onchainStates: readonly { name: string; note?: string; props: OnchainActionProps }[] = [
  {
    name: 'idle',
    note: 'Review',
    props: { ...sheet, state: 'idle', actionLabel: 'Pay $0.40 USDC' },
  },
  {
    name: 'idle',
    note: 'after signing → idle (declined, neutral)',
    props: {
      ...sheet,
      state: 'idle',
      actionLabel: 'Pay $0.40 USDC',
      declined: true,
      walletName: 'MetaMask',
    },
  },
  {
    name: 'idle',
    note: 'pre-flight blocked',
    props: {
      ...sheet,
      state: 'idle',
      actionLabel: 'Pay $0.40 USDC',
      blocked: 'Hedera account has 0.12 USDC. Add 0.28 USDC or pay from Base.',
    },
  },
  {
    name: 'signing',
    note: 'Confirm in wallet',
    props: {
      ...sheet,
      state: 'signing',
      walletName: 'MetaMask',
      simulation: '0.40 USDC leaves your account; 100 MB arrives',
    },
  },
  {
    name: 'submitted',
    note: 'hash first shown here',
    props: { ...sheet, state: 'submitted', hash: HASH, elapsedMs: 4000, expectedMs: 5000 },
  },
  {
    name: 'pending',
    props: { ...sheet, state: 'pending', hash: HASH, elapsedMs: 6000, expectedMs: 5000 },
  },
  {
    name: 'pending',
    note: 'stuck flag: elapsed > 2 × expected',
    props: { ...sheet, state: 'pending', hash: HASH, elapsedMs: 12000, expectedMs: 5000 },
  },
  {
    name: 'confirmed',
    props: {
      ...sheet,
      state: 'confirmed',
      hash: HASH,
      result: '+100 MB · settled · 400 MB total',
      balances: { available: '300 MB', pending: '100 MB' },
      elapsedMs: 4000,
    },
  },
  {
    name: 'finalized',
    props: { ...sheet, state: 'finalized', hash: HASH, result: '+100 MB · 400 MB total' },
  },
  {
    name: 'failed',
    note: 'before broadcast',
    props: {
      ...sheet,
      state: 'failed',
      reason: 'the facilitator rejected the signature (expired)',
    },
  },
  {
    name: 'failed',
    note: 'on chain, fee charged',
    props: {
      ...sheet,
      title: 'Gift 1 GB to rahul.eth · $4.00',
      network: 'Base',
      explorerUrl: 'https://sepolia.basescan.org/tx/{hash}',
      explorerName: 'Basescan',
      state: 'failed',
      reason: 'the gift escrow is paused',
      feeCharged: '$0.01',
      hash: HASH,
    },
  },
  {
    name: 'replaced',
    note: 'speed-up; the new hash starts a row at submitted',
    props: {
      ...sheet,
      state: 'replaced',
      hash: HASH,
      replacement: { hash: REPLACEMENT_HASH, kind: 'speed-up' },
    },
  },
  {
    name: 'replaced',
    note: 'cancel',
    props: {
      ...sheet,
      state: 'replaced',
      hash: HASH,
      replacement: { hash: REPLACEMENT_HASH, kind: 'cancel' },
      feeCharged: '$0.01',
    },
  },
];

const coupon = {
  mb: 300,
  sponsor: 'Hedera',
  validity: 'Mumbai · 7 days',
  usageAsOf: NOW,
  serial: serialFor(0),
  expires: 'Expires 30 Nov 2026',
  qrUrl: `${HOST}/card/${serialFor(0)}`,
} as const;

export default function ComponentGallery() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-8">
      <header className="grid gap-3 border-b border-border-strong pb-4">
        <p className="m-0 font-mono text-12 text-ink-tertiary">
          TOOLING · @ethglobal/ui · not a product page · noindex
        </p>
        <h1 className="m-0 font-mono text-24 text-ink">Component gallery</h1>
        <p className="m-0 max-w-prose text-14 text-ink-secondary">
          Every component in every state, each rendered twice: light and dark via data-color-scheme.
          Data is frozen at Sun 8 Nov 14:02 IST. The QR is a labelled slot; the app supplies the
          encoder.
        </p>
        <nav className="flex flex-wrap gap-4 font-mono text-13">
          <Link className="text-accent" href="/">
            Token sheet
          </Link>
          <Link className="text-accent" href="/ui/print?count=10">
            Print sheet (10 per A4)
          </Link>
          <Link className="text-accent" href="/ui/print?count=10&side=back">
            Print backs
          </Link>
          <Link className="text-accent" href="/ui/print?count=1&layout=single">
            Single card page
          </Link>
        </nav>
      </header>

      <Group id="coupon" title="Coupon" source="design-references §1(a), §1(c), §3">
        <State name="screen" note="live, sponsor line, PIN 4 × 4, usage as of, QR slot">
          <Coupon {...coupon} pin={PINS[0]} renderQr={renderQrSlot} />
        </State>
        <State name="screen" note="no PIN yet (landing)">
          <Coupon mb={300} sponsor="Hedera" validity="Mumbai · 7 days" />
        </State>
        <State name="screen" note="exhausted">
          <Coupon
            mb={300}
            sponsor="Hedera"
            status="Sponsor bundles finished for today · next batch 09:00 IST"
          />
        </State>
        <State name="screen" note='lang="hi"; numerals stay Latin'>
          <Coupon {...coupon} lang="hi" pin={PINS[1]} />
        </State>
        <State name="screen" note="1.5 GB">
          <Coupon mb={1500} sponsor="Hedera" usageAsOf={NOW} />
        </State>
        <State name="notification" note="two lines">
          <Coupon
            mb={300}
            sponsor="Hedera"
            variant="notification"
            note="Install takes 2 minutes."
          />
        </State>
        <State name="notification" note='lang="hi"'>
          <Coupon mb={300} sponsor="Hedera" variant="notification" lang="hi" />
        </State>
        <State name="print" note="one cell of the A4 sheet, millimetres">
          <div
            className="print-root"
            data-layout="a4"
            style={{ background: 'transparent', padding: 0 }}
          >
            <div
              className="print-cell"
              style={{ width: '85.6mm', height: '53.98mm', margin: '2mm' }}
            >
              <Coupon {...coupon} pin={PINS[0]} variant="print" renderQr={renderQrSlot} />
            </div>
          </div>
        </State>
      </Group>

      <Group id="scratch" title="ScratchCard" source="design-references §5.3">
        <State name="covered" note="drag to scratch (24 px brush, 45 %) or Reveal PIN">
          <ScratchDemo {...coupon} pin={PINS[2]} />
        </State>
        <State name="revealed" note="revealed prop">
          <ScratchDemo {...coupon} pin={PINS[3]} revealed />
        </State>
        <State name="reduced motion" note="system setting: latex block, button only, 100 ms">
          <p className="m-0 text-13 text-ink-secondary">
            Turn on reduced motion in the OS to see the canvas replaced by a latex block.
          </p>
        </State>
      </Group>

      <Group id="meter" title="MbMeter" source="design-references §1(c), §6">
        <State name="full" note="fills once on first read (fillOnce)">
          <MbMeter remainingMb={300} totalMb={300} usageAsOf={NOW} fillOnce />
        </State>
        <State name="in use">
          <MbMeter remainingMb={212} totalMb={300} usageAsOf={NOW} />
        </State>
        <State name="warning" note="≥ 80 % used: meter and usage line turn --warning">
          <MbMeter remainingMb={48} totalMb={300} usageAsOf={NOW} />
        </State>
        <State name="simulated" note="Q-USER-RECHARGE-2">
          <MbMeter remainingMb={160} totalMb={400} usageAsOf={NOW} source="simulated usage" />
        </State>
        <State name="empty">
          <MbMeter remainingMb={0} totalMb={300} usageAsOf={NOW} />
        </State>
        <State name='lang="hi"'>
          <MbMeter remainingMb={212} totalMb={300} usageAsOf={NOW} lang="hi" />
        </State>
      </Group>

      <Group id="usage" title="UsageAsOf" source="design-references §1(c)">
        <State name="default">
          <UsageAsOf at={NOW} />
        </State>
        <State name="viewer outside IST" note="zone appended">
          <UsageAsOf at={NOW} viewerTimeZone="Europe/London" />
        </State>
        <State name="warning">
          <UsageAsOf at={NOW} tone="warning" />
        </State>
        <State name='lang="hi"'>
          <UsageAsOf at={NOW} lang="hi" />
        </State>
      </Group>

      <Group id="boarding" title="BoardingPass" source="design-references §1(f)">
        <State name="open" note="countdown as text">
          <BoardingPass
            to="rahul.eth"
            from="you"
            mb={1000}
            claimBy={CLAIM_BY}
            now={NOW}
            pin={PINS[4]}
            serial={serialFor(4)}
            qrUrl={`${HOST}/card/${serialFor(4)}`}
            renderQr={renderQrSlot}
          />
        </State>
        <State name="last hour" note="seconds shown under 1 h">
          <BoardingPass
            to="rahul.eth"
            from="vitalik.eth"
            mb={300}
            claimBy={CLAIM_BY}
            now={CLAIM_BY - 42 * 60_000 - 10_000}
            pin={PINS[5]}
            serial={serialFor(5)}
          />
        </State>
        <State name="claimed">
          <BoardingPass
            to="rahul.eth"
            from="you"
            mb={3000}
            claimBy={CLAIM_BY}
            now={NOW}
            status="claimed"
          />
        </State>
        <State name="lapsed">
          <BoardingPass
            to="rahul.eth"
            from="you"
            mb={1000}
            claimBy={CLAIM_BY}
            now={CLAIM_BY + 60_000}
            status="lapsed"
          />
        </State>
      </Group>

      <Group
        id="onchain"
        title="OnchainAction"
        source="packages/ui/README.md · design-foundations §6"
      >
        {onchainStates.map((entry, index) => (
          <State key={index} name={entry.name} {...(entry.note ? { note: entry.note } : {})}>
            <OnchainAction {...entry.props} />
          </State>
        ))}
      </Group>

      <Group id="receipt" title="Receipt" source="design-references §1(g)">
        <State name="sponsored">
          <Receipt
            heading="+300 MB · Sun 8 Nov 14:02 · Hedera · Final"
            you="$0.00"
            sponsor="$0.50"
            networkFee="$0.00"
          />
        </State>
        <State name="paid">
          <Receipt
            heading="+100 MB · Sat 7 Nov 03:12 · Hedera · Final"
            you="$0.40"
            networkFee="$0.00"
          />
        </State>
        <State name="failed" note="only the amount turns --negative">
          <Receipt
            heading="+100 MB · Sat 7 Nov 03:14 · Base · Failed"
            you="$0.40"
            networkFee="$0.01"
            failed
          />
        </State>
      </Group>

      <Group id="primitives" title="Button · Field" source="design-foundations §2, §7">
        <State name="Button" note="primary · secondary · quiet · disabled">
          <div className="flex flex-wrap gap-3">
            <Button>Prove I&apos;m human → 300 MB</Button>
            <Button variant="secondary">Enter a coupon PIN</Button>
            <Button variant="quiet">Later — it&apos;s under Plan</Button>
            <Button disabled>Pay $0.40 USDC</Button>
          </div>
        </State>
        <State name="Field" note="default · mono · error">
          <div className="grid max-w-sm gap-4">
            <Field
              label="Who gets it?"
              placeholder="rahul.eth"
              hint="rahul.eth → 0x1a2b…9f3e · Ethereum mainnet"
              mono
            />
            <Field
              label="Coupon PIN"
              inputMode="numeric"
              defaultValue="4821 9930 1127 5065"
              mono
              error="That PIN fails its check digit. Look again at the last four."
            />
          </div>
        </State>
      </Group>
    </main>
  );
}
