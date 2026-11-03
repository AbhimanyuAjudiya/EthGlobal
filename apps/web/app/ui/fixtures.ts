/**
 * Fixed data for the component gallery and the print sheet (tooling only). Every PIN is 16 digits with a
 * valid Verhoeff check digit (generated once with @ethglobal/protocol's generatePin); the first is the spec's.
 * Times are frozen so server and client render the same text.
 */
export const PINS = [
  '4821993011275064',
  '2950595390095615',
  '4176728488628584',
  '4327483739731849',
  '0579089972398836',
  '0615201634337366',
  '9284398591735669',
  '9090232849336877',
  '7583508288037667',
  '4810148859894711',
  '3433015463023532',
  '6427953180639179',
  '0305016938406866',
  '8334886076041255',
  '7028453339405871',
  '3865931997583623',
  '4398387813057515',
  '6268509295691518',
  '7643095607933313',
  '5479126724223786',
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
