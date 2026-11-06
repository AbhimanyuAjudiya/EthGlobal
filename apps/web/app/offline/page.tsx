import { ButtonLink, Notice, PageHeader } from '../../components/kit';
import { AppShell } from '../../components/Shell';
import { T } from '../../i18n/lang';

export const metadata = { title: 'Offline' };

/** The service worker's fallback page (precached): the kit template with one warning and the way back to the plan. */
export default function Offline() {
  return (
    <AppShell
      nav="plan"
      action={
        <ButtonLink href="/plan" variant="primary" size="lg" block native>
          <T k="tab.plan" />
        </ButtonLink>
      }
    >
      <PageHeader title={<T k="offline.title" />} />
      <Notice tone="warning">
        <T k="offline.body" />
      </Notice>
    </AppShell>
  );
}
