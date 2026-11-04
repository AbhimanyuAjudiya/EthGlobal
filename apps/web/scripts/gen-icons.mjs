#!/usr/bin/env node
/**
 * Generates the PWA icons programmatically (no stock art): an oxide-teal tile carrying the coupon's 4 × 4 PIN
 * grid in paper ink. `any` icons fill the tile edge to edge with a small radius; `maskable` icons keep the grid
 * inside the 80 % safe zone on a full-bleed teal ground. Pure Node (zlib + a CRC32), deterministic output.
 *
 *   node apps/web/scripts/gen-icons.mjs        # writes apps/web/public/icons/*
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = path.join(import.meta.dirname, '..', 'public', 'icons');
const TEAL = [0x11, 0x78, 0x78];
const PAPER = [0xfb, 0xfa, 0xf7];

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The 4 × 4 PIN grid: rounded cells inside `box` (fraction of the tile), paper on teal. */
function icon(size, { maskable }) {
  const box = maskable ? 0.5 : 0.62; // grid span; maskable stays well inside the 80 % safe circle
  const cell = (box * size) / 4;
  const dot = cell * 0.62;
  const origin = (size - box * size) / 2;
  const radius = maskable ? 0 : size * 0.18;
  const insideTile = (x, y) => {
    if (radius === 0) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  return png(size, (x, y) => {
    if (!insideTile(x, y)) return PAPER;
    const gx = (x - origin) / cell;
    const gy = (y - origin) / cell;
    if (gx >= 0 && gx < 4 && gy >= 0 && gy < 4) {
      const dx = (gx % 1) - 0.5;
      const dy = (gy % 1) - 0.5;
      const r = dot / cell / 2;
      if (dx * dx + dy * dy <= r * r) return PAPER;
    }
    return TEAL;
  });
}

function svg() {
  const cells = [];
  for (let r = 0; r < 4; r += 1)
    for (let c = 0; c < 4; c += 1)
      cells.push(`<circle cx="${19 + c * 15.5 + 7.75}" cy="${19 + r * 15.5 + 7.75}" r="4.8"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#117878"/><g fill="#fbfaf7">${cells.join('')}</g></svg>\n`;
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': icon(192, { maskable: false }),
  'icon-512.png': icon(512, { maskable: false }),
  'maskable-192.png': icon(192, { maskable: true }),
  'maskable-512.png': icon(512, { maskable: true }),
  'apple-touch-icon.png': icon(180, { maskable: true }),
  'icon.svg': Buffer.from(svg()),
};
for (const [name, data] of Object.entries(files)) writeFileSync(path.join(OUT, name), data);
console.log(`icons: ${Object.keys(files).join(', ')} → ${path.relative(process.cwd(), OUT)}`);
