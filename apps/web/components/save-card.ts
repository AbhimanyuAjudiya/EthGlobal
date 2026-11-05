/**
 * "Save card": the boarding pass as a 1080 × 1920 PNG drawn on a canvas (no screenshot library, no image
 * service): paper ground, the fields in the bazaar faces, the PIN 4 × 4 in Chivo Mono and the QR to
 * /card/<serial>. The file never leaves the device.
 */
import { encode } from 'uqr';

import type { GiftResponse } from '@ethglobal/protocol/schemas';
import { dateTime, formatData, pinGroups } from '@ethglobal/ui/components';

const W = 1080;
const H = 1920;

export async function saveCardPng(gift: GiftResponse, qrUrl: string): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  await document.fonts?.ready;
  const style = getComputedStyle(document.documentElement);
  const display = style.getPropertyValue('--font-display') || 'sans-serif';
  const mono = style.getPropertyValue('--font-mono') || 'monospace';

  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a1510';
  ctx.font = `700 64px ${display}`;
  ctx.fillText('Recharge', 96, 200);
  ctx.font = `500 40px ${display}`;
  ctx.fillStyle = '#57514c';
  ctx.fillText('Data gift', 96, 270);

  const field = (label: string, value: string, y: number) => {
    ctx.fillStyle = '#75716b';
    ctx.font = `600 32px ${display}`;
    ctx.fillText(label.toUpperCase(), 96, y);
    ctx.fillStyle = '#1a1510';
    ctx.font = `700 64px ${display}`;
    ctx.fillText(value, 96, y + 76);
  };
  field('To', gift.name, 420);
  field('From', 'you', 600);
  field('Data', formatData(gift.mb), 780);
  field('City', 'MUMBAI', 960);
  field('Valid until', dateTime(gift.claimBy), 1140);

  ctx.strokeStyle = '#a29e99';
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(64, 1300);
  ctx.lineTo(W - 64, 1300);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#1a1510';
  ctx.font = `500 52px ${mono}`;
  const [a, b, c, d] = pinGroups(gift.pin);
  ctx.fillText(`${a} ${b}`, 96, 1420);
  ctx.fillText(`${c} ${d}`, 96, 1500);
  ctx.font = `400 34px ${mono}`;
  ctx.fillStyle = '#57514c';
  ctx.fillText(gift.serial, 96, 1580);

  const qr = encode(qrUrl, { ecc: 'M', border: 2 });
  const cell = Math.floor(400 / qr.size);
  const x0 = W - 96 - cell * qr.size;
  const y0 = 1360;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0, cell * qr.size, cell * qr.size);
  ctx.fillStyle = '#000000';
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
    }),
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `recharge-gift-${gift.serial}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
