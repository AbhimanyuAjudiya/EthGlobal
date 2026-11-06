'use client';

import {
  ActionBar,
  AppShell,
  BalanceCard,
  Button,
  ListGroup,
  ListRow,
  Avatar,
  Notice,
  PageHeader,
  PageSplit,
  Pill,
  QuickActions,
  Section,
} from '../../../components/kit';

/**
 * Tooling (MODE=local only, app/ui/layout.tsx): the page template assembled from the kit, for screenshots. A `split`
 * page: on a phone everything stacks with the ActionBar last; from 1024 px the hero (and its ActionBar) sits sticky
 * in columns 1–5 and the rest in 6–12.
 */
export default function KitTemplate() {
  return (
    <AppShell nav="plan" money layout="split">
      <PageHeader eyebrow="Mumbai Welcome" title="Your plan" />
      <PageSplit
        hero={
          <>
            <BalanceCard
              eyebrow="Data left"
              amount={640}
              unit="MB"
              meter={{ used: 360, total: 1000, label: 'Data left' }}
              status={
                <Pill tone="positive" dot>
                  Ready
                </Pill>
              }
              caption="usage as of 14:02"
            />
            <QuickActions
              label="Plan actions"
              items={[
                { icon: 'install', label: 'Install', href: '/ui/kit' },
                { icon: 'topup', label: 'Add data', href: '/ui/kit' },
                { icon: 'gift', label: 'Gift', href: '/ui/kit' },
                { icon: 'receipt', label: 'Receipts', href: '/ui/kit' },
              ]}
            />
            <ActionBar>
              <Button size="lg" block>
                Install eSIM · 2 min
              </Button>
              <Button variant="quiet">Didn&apos;t open? Tap again</Button>
            </ActionBar>
          </>
        }
      >
        <Section title="Details">
          <ListGroup>
            <ListRow title="Expires" value="Sun 15 Nov · 09:12" />
            <ListRow leading={<Avatar label="Hedera" />} title="Sponsor" value="Hedera" />
            <ListRow title="Network" value="Jio · LTE" />
            <ListRow title="Receipt" subtitle="You · Sponsor · Fee" href="/ui/kit" />
          </ListGroup>
        </Section>
        <Notice tone="info">One free bundle per human, not per phone.</Notice>
      </PageSplit>
    </AppShell>
  );
}
