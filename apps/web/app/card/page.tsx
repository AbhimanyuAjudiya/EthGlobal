import { ScratchRedeem } from '../../components/ScratchRedeem';

export const metadata = { title: 'Redeem a coupon' };

/** `/card` — the `*123*PIN#` homage: type the PIN from any card. */
export default function Card() {
  return <ScratchRedeem />;
}
