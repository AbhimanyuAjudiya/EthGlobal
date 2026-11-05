import { describe, expect, it } from 'vitest';

import { isValidPin } from '@ethglobal/protocol/pin';

import { PINS } from '../app/ui/fixtures';

/** RT-W-10: the tooling print sheet can never pass for a real card — every fixture PIN fails the Verhoeff check. */
describe('/ui fixtures', () => {
  it('every gallery PIN is 16 digits and void on purpose', () => {
    for (const pin of PINS) {
      expect(pin).toMatch(/^\d{16}$/);
      expect(isValidPin(pin), pin).toBe(false);
    }
  });
});
