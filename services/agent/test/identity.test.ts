import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hcs14Uaid, type Hcs14Input } from '@ethglobal/adapters/live';
import { loadFixture } from '@ethglobal/adapters/testing';

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

  it('nativeId follows the configured Hedera network: hedera:mainnet:<account>', async () => {
    expect(uaidInput('0.0.5005', 'hedera:mainnet').nativeId).toBe('hedera:mainnet:0.0.5005');
    expect(uaidInput('0.0.5005', 'hedera:testnet').nativeId).toBe('hedera:testnet:0.0.5005');
    const dir = await tempDir();
    const log = memoryLog();
    const testnet = await resolveUaid({
      stateDir: dir,
      hederaAccountId: '0.0.5005',
      network: 'hedera:testnet',
      compute: hcs14Uaid,
      log,
    });
    const mainnet = await resolveUaid({
      stateDir: dir,
      hederaAccountId: '0.0.5005',
      network: 'hedera:mainnet',
      compute: hcs14Uaid,
      log,
    });
    expect(mainnet).toMatch(/;nativeId=hedera:mainnet:0\.0\.5005$/);
    expect(mainnet).not.toBe(testnet); // the network is part of the identity, not only the account
    expect(log.lines.some((l) => l.level === 'warn')).toBe(true); // the stored testnet UAID was replaced
  });

  it('matches the HCS-14 vector recorded from @hashgraphonline/standards-sdk@0.1.192 createUaid', () => {
    const { cases } = loadFixture<{ cases: { name: string; input: Hcs14Input; uaid: string }[] }>(
      'hcs/hcs14-vector.json',
    );
    const ref = cases.find((c) => c.name.startsWith('services/agent'));
    if (!ref) throw new Error('hcs14-vector.json has no services/agent case');
    // the recorded input is this agent's uaidInput at the version it was recorded with
    const input = { ...uaidInput('0.0.6006'), version: ref.input.version };
    expect(input).toEqual(ref.input);
    expect(hcs14Uaid(input)).toBe(ref.uaid);
  });

  it('AGENT_VERSION equals package.json version', async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(AGENT_VERSION).toBe(pkg.version);
  });
});
