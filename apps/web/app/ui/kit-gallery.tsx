'use client';

import { useState, type ReactNode } from 'react';

import {
  ActionBar,
  Amount,
  Avatar,
  BalanceCard,
  Button,
  ButtonLink,
  Card,
  ChoiceChips,
  EmptyState,
  Field,
  KIT_ICONS,
  KitIcon,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  QuickActions,
  Section,
  Sheet,
  Skeleton,
  StatTile,
  Stepper,
  Table,
  Ticket,
} from '../../components/kit';

/** One kit piece, light and dark side by side (each pane pins its palette). */
function Pane({ name, children }: { name: string; children: ReactNode }) {
  return (
    <figure className="m-0 grid gap-2 border-t border-border-subtle pt-3">
      <figcaption className="font-mono text-12 text-ink-secondary">{name}</figcaption>
      <div className="grid gap-3 md:grid-cols-2">
        {(['light', 'dark'] as const).map((scheme) => (
          <div
            key={scheme}
            className="flex min-w-0 flex-col gap-4 overflow-x-auto rounded-(--radius-card) bg-canvas p-(--space-5) text-ink"
            data-color-scheme={scheme}
          >
            {children}
          </div>
        ))}
      </div>
    </figure>
  );
}

function ChipsDemo() {
  const [size, setSize] = useState('1000');
  return (
    <ChoiceChips
      label="Size"
      showLabel
      value={size}
      onChange={setSize}
      options={[
        { value: '300', label: '300 MB', sub: '$1.20' },
        { value: '1000', label: '1 GB', sub: '$4.00' },
        { value: '3000', label: '3 GB', sub: '$12.00' },
        { value: 'x', label: '10 GB', sub: 'Sold out', disabled: true },
      ]}
    />
  );
}

function SwitchDemo() {
  const [on, setOn] = useState(false);
  return (
    <ListGroup>
      <ListRow title="Pause the agent" trailing="switch" checked={on} onCheckedChange={setOn} />
    </ListGroup>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open receipt sheet
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="+1 GB · $4.00">
        <ListGroup flush>
          <ListRow title="You" value="$4.00" />
          <ListRow title="Sponsor" value="—" />
          <ListRow title="Network fee" value="$0.00" />
        </ListGroup>
      </Sheet>
    </>
  );
}

const HASH = '0x1a2b80f6cd88a88474e7c4db5d3de758f33eeaf3368b639ab1f4681d81789f3e';

/** Every kit component (components/kit, DESIGN.md §5) in its states. */
export function KitGallery() {
  return (
    <section aria-labelledby="kit" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kit" className="m-0 font-mono text-16 text-ink">
          Kit (components/kit)
        </h2>
        <p className="m-0 font-mono text-12 text-ink-tertiary">
          DESIGN.md v3 §5 · /ui/kit = the template
        </p>
      </div>

      <Pane name="Type styles">
        <p className="t-display-xl">1 GB</p>
        <p className="t-display">Who gets it?</p>
        <p className="t-title">Your plans</p>
        <p className="t-heading">How it works</p>
        <p className="t-body-lg">A sponsor pays your first 1 GB.</p>
        <p className="t-body">World checks you&apos;re one human.</p>
        <p className="t-label">Add 1 GB · $4.00</p>
        <p className="t-caption">usage as of 14:02</p>
        <p className="t-mono">4821 9930 1127 5065</p>
        <p className="t-display" lang="hi">
          कौन लेगा?
        </p>
      </Pane>

      <Pane name="PageHeader · title / display, eyebrow, lead, action">
        <PageHeader
          eyebrow="Step 1 of 3"
          title="Prove you're one human"
          lead="World checks you're one human. We get a code that can't be traced to you."
        />
        <PageHeader
          size="display"
          title="Land in India. Be online in two minutes."
          action={
            <ButtonLink href="/ui" variant="quiet">
              Download CSV
            </ButtonLink>
          }
        />
      </Pane>

      <Pane name="BalanceCard · brand / surface, meter, warning ≥ 80 %, status">
        <BalanceCard amount="1" unit="GB" note="free · 1,214 of 2,000 left" caption="from Hedera" />
        <BalanceCard
          tone="surface"
          eyebrow="Data left"
          amount={640}
          unit="MB"
          meter={{ used: 360, total: 1000, label: 'Data left' }}
          status={
            <Pill tone="positive" dot>
              Installed
            </Pill>
          }
          caption={
            <>
              <span>usage as of 14:02</span>
              <span>Expires Sun 15 Nov · 09:12</span>
            </>
          }
        />
        <BalanceCard
          tone="surface"
          amount={120}
          unit="MB"
          meter={{ used: 880, total: 1000 }}
          status={
            <Pill tone="warning" dot>
              88 % used
            </Pill>
          }
          caption="usage as of 14:02"
        />
      </Pane>

      <Pane name="Amount · sizes, prefix, tones">
        <Amount value="4.00" prefix="$" size="xl" />
        <Amount value={1214} unit="claims" size="display" />
        <Amount value="300" unit="MB" size="title" />
        <Amount value="0.40" prefix="$" size="heading" tone="negative" />
      </Pane>

      <Pane name="QuickActions · primary, disabled">
        <QuickActions
          label="Plan actions"
          items={[
            { icon: 'install', label: 'Install', href: '/ui', primary: true },
            { icon: 'topup', label: 'Add data', href: '/ui' },
            { icon: 'gift', label: 'Gift', href: '/ui' },
            { icon: 'receipt', label: 'Receipts', disabled: true },
          ]}
        />
      </Pane>

      <Pane name="Ticket · plain with brand stub">
        <Ticket stub="Claim by Sun 15 Nov · 09:12" aria-label="Gift ticket">
          <p className="t-caption">Data gift</p>
          <Amount value="1" unit="GB" size="xl" />
          <p className="t-body">to rahul.eth</p>
        </Ticket>
      </Pane>

      <Pane name="Section · Card tones · ListGroup / ListRow">
        <Section title="Details" action={{ label: 'See all', href: '/ui' }}>
          <ListGroup>
            <ListRow
              leading={<Avatar label="Jio" />}
              title="Mumbai Welcome"
              subtitle="Installed · expires Sun 15 Nov"
              value="640 MB"
              href="/ui"
            />
            <ListRow
              leading={<Avatar icon="human" />}
              title="Verified"
              subtitle="World ID · Orb"
              trailing={<Pill tone="positive">Done</Pill>}
            />
            <ListRow title="Arkiv key" value="0x1a2b…9f3e" mono />
            <ListRow title="Refund" value="−$4.00" valueTone="negative" onClick={() => undefined} />
          </ListGroup>
        </Section>
        <ListGroup title="Sat 7 Nov" meta="$8.00">
          <ListRow
            leading={<Avatar label="Hedera" />}
            title="+1 GB"
            subtitle="03:12 · Hedera · Final"
            value="$4.00"
          />
          <ListRow
            leading={<Avatar label="Base" />}
            title="+1 GB"
            subtitle="01:40 · Base · Final"
            value="$4.00"
          />
        </ListGroup>
        <SwitchDemo />
        <Card>
          <p className="t-heading">Card · surface</p>
          <p className="t-body">24 px radius, hairline on a white canvas.</p>
        </Card>
        <Card tone="band">
          <p className="t-body">Card · band</p>
        </Card>
        <Card tone="brand-pale">
          <p className="t-body">Card · brand-pale</p>
        </Card>
      </Pane>

      <Pane name="Avatar · Pill">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar label="Hedera Testnet" size={32} />
          <Avatar label="rahul.eth" />
          <Avatar icon="gift" size={48} tone="brand" />
          <Avatar label="OK" tone="positive" />
          <Avatar label="!" tone="warning" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill>Neutral</Pill>
          <Pill tone="brand" dot>
            Issuing
          </Pill>
          <Pill tone="positive" dot>
            Ready
          </Pill>
          <Pill tone="warning" dot>
            Paused
          </Pill>
          <Pill tone="negative" dot>
            Expired
          </Pill>
        </div>
      </Pane>

      <Pane name="ChoiceChips · Stepper">
        <ChipsDemo />
        <Stepper steps={['Who', 'Size', 'Pay']} current={2} label="Steps" />
        <Stepper steps={['Prove', 'Issue', 'Install']} current={1} label="Steps" />
      </Pane>

      <Pane name="Button · ButtonLink · Field">
        <div className="flex flex-wrap gap-3">
          <Button size="lg">Gift 1 GB to rahul.eth · $4.00</Button>
          <Button variant="secondary">Check connection</Button>
          <Button variant="quiet">Back</Button>
          <Button disabled>Pay $4.00 USDC</Button>
          <ButtonLink href="/ui" size="lg">
            Prove I&apos;m human → 1 GB
          </ButtonLink>
        </div>
        <Field label="ENS name" placeholder="rahul.eth" hint="rahul.eth → 0x1a2b…9f3e" mono />
        <Field
          label="Coupon PIN"
          defaultValue="4821 9930 1127 5065"
          mono
          error="That PIN fails its check digit."
        />
      </Pane>

      <Pane name="ActionBar (inline here) · Sheet">
        <ActionBar className="kit-demo-static">
          <Button size="lg" block>
            Pay $4.00 USDC
          </Button>
          <Button variant="quiet">Back</Button>
        </ActionBar>
        <SheetDemo />
      </Pane>

      <Pane name="Notice · info / warning / negative / positive">
        <Notice tone="info">One free bundle per human, not per phone.</Notice>
        <Notice
          tone="warning"
          title="88 % used"
          action={
            <ButtonLink href="/ui" variant="secondary">
              Add 1 GB · $4.00
            </ButtonLink>
          }
        >
          Data stops when the plan expires.
        </Notice>
        <Notice tone="negative" title="Payment failed">
          Nothing left your account.
        </Notice>
        <Notice tone="positive">
          Sponsor paid · {HASH.slice(0, 6)}…{HASH.slice(-4)}
        </Notice>
      </Pane>

      <Pane name="StatTile · Table (console)">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Live campaigns" value="2" />
          <StatTile
            label="Claims today"
            value="1,214"
            delta="+86 in the last hour"
            deltaTone="positive"
          />
          <StatTile label="Spend" value="$4,856" hint="of $8,000 budget" />
        </div>
        <Table
          caption="Campaigns"
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' },
            { key: 'claims', label: 'Claims', numeric: true },
            { key: 'spend', label: 'Spend / budget', numeric: true },
          ]}
          rows={[
            {
              name: 'Mumbai Welcome',
              status: (
                <Pill tone="positive" dot>
                  Live
                </Pill>
              ),
              claims: '1,214',
              spend: '$4,856 / $8,000',
            },
            {
              name: 'ETHGlobal Delhi',
              status: (
                <Pill tone="warning" dot>
                  Paused
                </Pill>
              ),
              claims: '312',
              spend: '$1,248 / $2,000',
            },
          ]}
        />
      </Pane>

      <Pane name="EmptyState · Skeleton (balance, row, card, text)">
        <EmptyState
          title="No plans yet"
          body="Prove you're one human and a sponsor pays your first 1 GB."
          action={<ButtonLink href="/ui">Get a bundle</ButtonLink>}
        />
        <Skeleton shape="balance" label="Loading your plan" />
        <Skeleton shape="row" count={2} />
        <Skeleton shape="card" />
        <Skeleton shape="text" />
      </Pane>

      <Pane name="Icons (Lucide, stroke 1.75)">
        <div className="flex flex-wrap gap-3">
          {KIT_ICONS.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 font-mono text-11 text-ink-tertiary"
            >
              <KitIcon name={name} size={24} />
              {name}
            </span>
          ))}
        </div>
      </Pane>
    </section>
  );
}
