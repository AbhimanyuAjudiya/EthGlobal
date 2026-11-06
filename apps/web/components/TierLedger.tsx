'use client';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { Avatar, ListGroup, ListRow, type KitIconName } from './kit';
import { useLang } from '../i18n/lang';
import { formatMb, money, soldPlan } from '../lib/format';

/** "What you get": the honest tier table, from /plans campaign.bundleMb — never hard-coded (design-references §1b). */
export function TierLedger({ plans }: { plans: PlansResponse }) {
  const { t, lang } = useLang();
  const bundle = plans.campaign?.bundleMb;
  if (!bundle) return null;
  const sold = soldPlan(plans);
  const rows: readonly { label: string; icon: KitIconName; text: string }[] = [
    { label: 'Orb', icon: 'human', text: t('tier.orb', { mb: formatMb(bundle.orb) }) },
    {
      label: 'Document',
      icon: 'card',
      text: t('tier.document', { mb: formatMb(bundle.document) }),
    },
    {
      label: 'Device',
      icon: 'install',
      text: t('tier.device', { mb: formatMb(sold.mb), price: money(sold.usd6) }),
    },
  ];
  return (
    <ListGroup title={t('verify.whatYouGet')} data-testid="tier-ledger">
      {rows.map((row) => {
        const [name, ...rest] = row.text.split(' · ');
        return (
          <ListRow
            key={row.label}
            lang={lang}
            leading={<Avatar icon={row.icon} />}
            title={name ?? row.label}
            value={rest.join(' · ')}
          />
        );
      })}
    </ListGroup>
  );
}
