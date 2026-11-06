import { AppShell } from '../../components/kit';
import { ScratchRedeem } from '../../components/ScratchRedeem';

export const metadata = { title: 'Scratch card' };

/** `/card` — the `*123*PIN#` homage: type the PIN from any card. */
export default function Card() {
  return (
    <AppShell nav="more" back="/">
      <ScratchRedeem />
    </AppShell>
  );
}
