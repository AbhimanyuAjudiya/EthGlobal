import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hcs14Uaid } from '@ethglobal/adapters/live';

import { tempDir } from './helpers.js';
import { AGENT_VERSION, resolveUaid, uaidInput } from '../src/identity.js';
import { memoryLog } from '../src/log.js';

describe('identity (HCS-14 UAID)', () => {
  it('UAID persisted and stable across runs', async () => {
    const dir = await tempDir();
    const log = memoryLog();
    const a = await resolveUaid({
      stateDir: dir,
      hederaAccountId: '0.0.5005',
      compute: hcs14Uaid,
      log,
    });
    const b = await resolveUaid({
      stateDir: dir,
      hederaAccountId: '0.0.5005',
      compute: hcs14Uaid,
      log,
    });
    expect(a).toBe(b);
    expect((await readFile(join(dir, 'uaid'), 'utf8')).trim()).toBe(a);
    expect(a).toMatch(
      /^uaid:aid:[1-9A-HJ-NP-Za-km-z]+;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0\.0\.5005$/,
    );
    expect(log.lines.filter((l) => l.msg === 'agent: UAID')).toHaveLength(1); // logged once
  });

  it('a changed account replaces the stored UAID (with a warning)', async () => {
    const dir = await tempDir();
    const log = memoryLog();
    await resolveUaid({ stateDir: dir, hederaAccountId: '0.0.5005', compute: hcs14Uaid, log });
    const next = await resolveUaid({
      stateDir: dir,
      hederaAccountId: '0.0.5006',
      compute: hcs14Uaid,
      log,
    });
    expect(next).toContain('0.0.5006');
    expect(log.lines.some((l) => l.level === 'warn')).toBe(true);
  });

  it('AGENT_UAID override wins', async () => {
    const dir = await tempDir();
    const uaid = await resolveUaid({
      stateDir: dir,
      override: 'uaid:aid:override;uid=0',
      compute: hcs14Uaid,
      log: memoryLog(),
    });
    expect(uaid).toBe('uaid:aid:override;uid=0');
  });

  it('local mode uses the CAIP-10 placeholder account 0.0.0', () => {
    expect(uaidInput(undefined).nativeId).toBe('hedera:testnet:0.0.0');
    expect(hcs14Uaid(uaidInput(undefined))).toMatch(/nativeId=hedera:testnet:0\.0\.0$/);
  });

  it('matches the HCS-14 vector computed with @hashgraphonline/standards-sdk (runs now)', async () => {
    // createUaid exists at runtime but not in the 0.1.192 typings
    const sdk = (await import('@hashgraphonline/standards-sdk')) as unknown as {
      createUaid(input: object, params: { proto: string }): Promise<string>;
    };
    const input = uaidInput('0.0.6006');
    const reference = await sdk.createUaid({ ...input }, { proto: input.protocol });
    const ours = hcs14Uaid(input);
    const id = (s: string) => /^uaid:aid:([^;]+)/.exec(s)?.[1];
    expect(id(ours)).toBe(id(reference));
    const params = (s: string) => new Set(s.split(';').slice(1));
    expect(params(ours)).toEqual(params(reference));
  });

  it('AGENT_VERSION equals package.json version', async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(AGENT_VERSION).toBe(pkg.version);
  });
});
