import { Suspense } from 'react';

import { PayRoute } from '../../components/routes';

export const metadata = { title: 'Add data' };

export default function Pay() {
  return (
    <Suspense fallback={null}>
      <PayRoute />
    </Suspense>
  );
}
