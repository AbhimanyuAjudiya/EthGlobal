import { Suspense } from 'react';

import { Skeleton } from '../../../components/kit';
import { CardRoute } from '../../../components/routes';

export const metadata = { title: 'Scratch card' };

export default function CardSerial() {
  return (
    <Suspense fallback={<Skeleton shape="card" label="Loading the card" />}>
      <CardRoute />
    </Suspense>
  );
}
