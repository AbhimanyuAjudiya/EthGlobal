import { Suspense } from 'react';

import { ReceiptsRoute } from '../../components/routes';

export const metadata = { title: 'Receipts' };

export default function Receipts() {
  return (
    <Suspense fallback={null}>
      <ReceiptsRoute />
    </Suspense>
  );
}
