/**
 * Fixed data for the component gallery and the print sheet (tooling only, MODE=local only: app/ui/layout.tsx).
 * Every PIN is 16 digits whose last digit is one off a valid Verhoeff check digit, so it FAILS the on-device check
 * on purpose: a printout of /ui/print can never pass for a real card (RT-W-10). Times are frozen so server and
 * client render the same text.
 */
export const PINS = [
  '4821993011275065',
  '2950595390095616',
  '4176728488628585',
  '4327483739731840',
  '0579089972398837',
  '0615201634337367',
  '9284398591735660',
  '9090232849336878',
  '7583508288037668',
  '4810148859894712',
  '3433015463023533',
  '6427953180639170',
  '0305016938406867',
  '8334886076041256',
  '7028453339405872',
  '3865931997583624',
  '4398387813057516',
  '6268509295691519',
  '7643095607933314',
  '5479126724223787',
] as const;

export const HASH = '0x1a2b80f6cd88a88474e7c4db5d3de758f33eeaf3368b639ab1f4681d81789f3e';
export const REPLACEMENT_HASH =
  '0x5e6fe132e373afa7b6cf8061d0353ace8676fa2196e64b2e67c27486eed4a1b2';
export const HASHSCAN = 'https://hashscan.io/testnet/transaction/{hash}';

/** Sun 8 Nov 2026 14:02 IST. */
export const NOW = Date.UTC(2026, 10, 8, 8, 32);
/** Sun 15 Nov 2026 09:12 IST: the gift's claim deadline. */
export const CLAIM_BY = Date.UTC(2026, 10, 15, 3, 42);
export const HOST = 'https://recharge.example';

export const serialFor = (index: number) => `7f3a${(index + 0x10).toString(16).padStart(4, '0')}`;
