import { Suspense } from 'react';

import { VerifyRoute } from '../../components/routes';

export const metadata = { title: "Prove you're one human" };

export default function Verify() {
  return (
    <Suspense fallback={null}>
      <VerifyRoute />
    </Suspense>
  );
}
