'use client';

import type { PlansResponse } from '@ethglobal/protocol/schemas';
import { RuledList } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { formatMb, money } from '../lib/format';

/** The honest tier table, from /plans campaign.bundleMb — never hard-coded (design-references §1b). */
export function TierLedger({ plans }: { plans: PlansResponse }) {
  const { t, lang } = useLang();
  const bundle = plans.campaign?.bundleMb;
  if (!bundle) return null;
  const price = money(plans.paid.priceUsd6PerStep);
  const rows = [
    { label: 'Orb', text: t('tier.orb', { mb: formatMb(bundle.orb) }) },
    { label: 'Document', text: t('tier.document', { mb: formatMb(bundle.document) }) },
    { label: 'Device', text: t('tier.device', { price }) },
  ];
  return (
    <div className="tier-ledger" data-testid="tier-ledger">
      <RuledList
        rows={rows.map((row) => {
          const [name, ...rest] = row.text.split(' · ');
          return {
            label: <span lang={lang}>{name ?? row.label}</span>,
            value: <span lang={lang}>{rest.join(' · ')}</span>,
          };
        })}
      />
      <p className="note" lang={lang}>
        {t('verify.footnote')}
      </p>
    </div>
  );
}
