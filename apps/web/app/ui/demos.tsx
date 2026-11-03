'use client';

import { ScratchCard, type ScratchCardProps } from '@ethglobal/ui/components';

import { renderQrSlot } from './qr-slot';

/** ScratchCard takes a render prop, so the gallery renders it from a client boundary. */
export function ScratchDemo(props: Omit<ScratchCardProps, 'renderQr'>) {
  return <ScratchCard {...props} renderQr={renderQrSlot} />;
}
