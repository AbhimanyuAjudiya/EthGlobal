import { Suspense } from 'react';

import { CardRoute } from '../../../components/routes';

export const metadata = { title: 'Scratch card' };

export default function CardSerial() {
  return (
    <Suspense fallback={<div className="skeleton skeleton--coupon" aria-label="Loading the card" />}>
      <CardRoute />
    </Suspense>
  );
}
