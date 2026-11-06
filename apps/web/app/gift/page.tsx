import { ReclaimGift } from '../../components/ClaimGift';
import { GiftForm } from '../../components/GiftForm';
import { AppShell } from '../../components/kit';

export const metadata = { title: 'Gift data' };

/**
 * `/gift` — Stepper [Who, Size, Pay] on the gift tab, then the payer's reclaim list: both sign with the payer's
 * wallet (`useWallet('human')`); /gift/claim connects the recipient's, so the list cannot live there.
 */
export default function Gift() {
  return (
    <AppShell nav="gift" money>
      <GiftForm />
      <ReclaimGift />
    </AppShell>
  );
}
