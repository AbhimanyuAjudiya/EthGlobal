/**
 * Red-team verification variant for RT-P-01 (MODE=local binds loopback only): the regression boots with the default
 * and refuses `0.0.0.0`. Here: other spellings that bind every interface or a non-loopback address — the empty string
 * (Node's `listen(port, '')` binds all interfaces), `::`, `[::]`, `0`, an IPv4-mapped any, a hostname that merely
 * starts with localhost, whitespace. Property: MODE=local either refuses to boot or ends with a loopback HOST.
 */
import { describe, expect, it } from 'vitest';

import { parseEnv } from '../../src/env.js';

const LOOPBACK = /^(127(\.\d{1,3}){3}|::1|\[::1\]|localhost)$/i;

describe('verify RT-P-01: no non-loopback HOST in MODE=local', () => {
  it.each([
    '',
    ' ',
    '::',
    '[::]',
    '0',
    '0.0.0.0 ',
    '::ffff:0.0.0.0',
    'localhost.attacker.example',
    '127.0.0.1.nip.io',
    '127.0.0.1,0.0.0.0',
    '192.168.1.10',
  ])('HOST=%j ⇒ refused or loopback', (host) => {
    let bound: string | undefined;
    try {
      bound = parseEnv({ MODE: 'local', HOST: host }).HOST;
    } catch {
      bound = undefined;
    }
    if (bound !== undefined) expect(bound).toMatch(LOOPBACK);
  });

  it('control: HOST unset ⇒ 127.0.0.1', () => {
    expect(parseEnv({ MODE: 'local' }).HOST).toBe('127.0.0.1');
  });
});
