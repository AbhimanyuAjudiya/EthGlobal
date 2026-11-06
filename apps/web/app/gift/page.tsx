import { GiftForm } from '../../components/GiftForm';
import { AppShell } from '../../components/kit';

export const metadata = { title: 'Gift data' };

/** `/gift` — Stepper [Who, Size, Pay] on the gift tab; reclaiming lives on /gift/claim (DESIGN.md §7). */
export default function Gift() {
  return (
    <AppShell nav="gift" money>
      <GiftForm />
    </AppShell>
  );
}
