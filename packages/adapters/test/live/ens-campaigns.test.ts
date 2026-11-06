import { decodeFunctionData, getAddress, keccak256, labelhash, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { ENS_SPONSOR_TEXT_KEYS } from '@ethglobal/protocol/ids';

import {
  API_RESOLVER_ROLES,
  dnsName,
  EnsCampaigns,
  RESOLVER_ABI,
  textResource,
} from '../../src/live/ens-campaigns.js';
import { MockCampaignNames } from '../../src/mocks/campaign-names.js';
import { anvilAccounts, anvilKeys } from '../../src/testing/index.js';

import type { CampaignNameInput } from '../../src/types.js';

const account = privateKeyToAccount(anvilKeys[2]);
const SPONSOR = getAddress(anvilAccounts[3]);
const REGISTRY = getAddress('0x297320862052b1d0e069502c0d5de12841e2ea41');
const RESOLVER = getAddress('0xe1ea7ec45d82cb79e8dfd959f4abfe1212e64c1f');
const NOW = 1_800_000_000_000;
const ID: Hex = `0x${'ab'.repeat(32)}`;

const input = (over: Partial<CampaignNameInput> = {}): CampaignNameInput => ({
  campaignId: ID,
  slug: 'mumbai-airport',
  sponsor: SPONSOR,
  expiresAt: NOW + 7 * 86_400_000,
  records: {
    url: 'https://app.recharge.ajudiya.com/c/mumbai-airport',
    description: 'Mumbai Airport',
  },
  ...over,
});

/**
 * A chain that applies what the adapter sends: deployProxy puts code at RESOLVER, register marks the label, the
 * grant multicall records roles. `staleNonce` is what a lagging node answers for the pending count.
 */
function fakeChain(opts: { staleNonce?: number; failWrite?: string } = {}) {
  const log: string[] = [];
  const writes: { functionName: string; nonce: number; args: readonly unknown[] }[] = [];
  const code = new Map<string, Hex>();
  const labels = new Map<string, { status: number; resolver: string }>();
  const roles = new Set<string>();
  let chainNonce = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let failWrite = opts.failWrite;
  const publicClient = {
    readContract: async (a: { functionName: string; args: readonly unknown[] }) => {
      log.push(`read:${a.functionName}`);
      if (a.functionName === 'predictProxyAddress') return RESOLVER;
      if (a.functionName === 'getStatus')
        return (
          [...labels.entries()].find(([l]) => BigInt(labelhash(l)) === a.args[0])?.[1].status ?? 0
        );
      if (a.functionName === 'getResolver') return labels.get(a.args[0] as string)?.resolver;
      if (a.functionName === 'hasRoles')
        return roles.has(`${String(a.args[0])}:${String(a.args[2]).toLowerCase()}`);
      throw new Error(`unexpected read ${a.functionName}`);
    },
    getCode: async ({ address }: { address: string }) => {
      log.push('getCode');
      return code.get(address.toLowerCase()) ?? '0x';
    },
    getTransactionCount: async () => opts.staleNonce ?? chainNonce,
    estimateContractGas: async (a: { functionName: string }) => {
      log.push(`estimate:${a.functionName}`);
      return 100_000n;
    },
    waitForTransactionReceipt: async () => {
      inFlight -= 1;
      return { status: 'success' as const };
    },
  };
  const walletClient = {
    account,
    chain: undefined,
    writeContract: async (a: {
      functionName: string;
      nonce: number;
      args: readonly unknown[];
      address: string;
    }) => {
      if (a.nonce < chainNonce) throw new Error('nonce too low: next nonce 3, tx nonce 1');
      if (failWrite === a.functionName) {
        failWrite = undefined;
        throw new Error('connection reset');
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      chainNonce = a.nonce + 1;
      writes.push({ functionName: a.functionName, nonce: a.nonce, args: a.args });
      log.push(`write:${a.functionName}`);
      if (a.functionName === 'deployProxy') code.set(RESOLVER.toLowerCase(), '0x6080');
      if (a.functionName === 'register')
        labels.set(a.args[0] as string, { status: 2, resolver: a.args[3] as string });
      if (a.functionName === 'multicall') {
        for (const call of a.args[0] as Hex[]) {
          const grant = decodeFunctionData({ abi: RESOLVER_ABI, data: call });
          const setter = decodeFunctionData({ abi: RESOLVER_ABI, data: grant.args[0] as Hex });
          roles.add(
            `${textResource(setter.args[1] as string)}:${String(grant.args[1]).toLowerCase()}`,
          );
        }
      }
      return keccak256(toBytes(`tx-${a.nonce}`));
    },
  };
  const names = new EnsCampaigns({
    publicClient: publicClient as never,
    walletClient: walletClient as never,
    parent: 're-charge.eth',
    userRegistry: REGISTRY,
    now: () => NOW,
  });
  return {
    names,
    log,
    writes,
    labels,
    get maxInFlight() {
      return maxInFlight;
    },
    setChainNonce: (n: number) => (chainNonce = n),
  };
}

describe('EnsCampaigns (live adapter over a fake chain)', () => {
  it('deploys the resolver with the records, registers to the sponsor with no roles, then grants only the sponsor keys', async () => {
    const chain = fakeChain();
    const seen: string[] = [];
    const out = await chain.names.ensureCampaignName(
      input({ onTx: (step) => void seen.push(step) }),
    );
    expect(out.name).toBe('mumbai-airport.re-charge.eth');
    expect(out.resolver).toBe(RESOLVER);
    expect(out.txs.map((t) => t.step)).toEqual(['resolver', 'register', 'grant']);
    expect(seen).toEqual(['resolver', 'register', 'grant']);
    expect(chain.writes.map((w) => [w.functionName, w.nonce])).toEqual([
      ['deployProxy', 0],
      ['register', 1],
      ['multicall', 2],
    ]);

    const [impl, salt, init] = chain.writes[0]!.args as [string, bigint, Hex];
    expect(getAddress(impl)).toBe(getAddress('0x115eb53f0c60696633855f90b138178fb40b2b2c'));
    expect(salt).toBe(BigInt(keccak256(ID)));
    const initialize = decodeFunctionData({ abi: RESOLVER_ABI, data: init });
    const [grants, calls] = initialize.args as [{ account: string; roleBitmap: bigint }[], Hex[]];
    expect(grants).toEqual([{ account: account.address, roleBitmap: API_RESOLVER_ROLES }]);
    const node = dnsName('mumbai-airport.re-charge.eth');
    expect(calls.map((c) => decodeFunctionData({ abi: RESOLVER_ABI, data: c }).args)).toEqual([
      [node, 'url', 'https://app.recharge.ajudiya.com/c/mumbai-airport'],
      [node, 'description', 'Mumbai Airport'],
    ]);

    const [label, owner, subregistry, resolver, roleBitmap, expiry] = chain.writes[1]!.args;
    expect([label, owner, subregistry, resolver, roleBitmap]).toEqual([
      'mumbai-airport',
      SPONSOR,
      '0x0000000000000000000000000000000000000000',
      RESOLVER,
      0n,
    ]);
    expect(expiry).toBe(BigInt((NOW + 7 * 86_400_000) / 1000));

    const granted = (chain.writes[2]!.args[0] as Hex[]).map((call) => {
      const grant = decodeFunctionData({ abi: RESOLVER_ABI, data: call });
      expect(grant.functionName).toBe('grantSetterRoles');
      expect(grant.args[1]).toBe(SPONSOR);
      return decodeFunctionData({ abi: RESOLVER_ABI, data: grant.args[0] as Hex }).args[1];
    });
    expect(granted).toEqual([...ENS_SPONSOR_TEXT_KEYS]);
    expect(chain.log.indexOf('write:deployProxy')).toBeLessThan(
      chain.log.indexOf('read:getStatus'),
    );
  });

  it('is idempotent: a second run reads, finds everything done and sends nothing', async () => {
    const chain = fakeChain();
    await chain.names.ensureCampaignName(input());
    const before = chain.log.length;
    const again = await chain.names.ensureCampaignName(input());
    expect(again.txs).toEqual([]);
    expect(chain.writes).toHaveLength(3);
    expect(chain.log.slice(before)).toEqual([
      'read:predictProxyAddress',
      'getCode',
      'read:getStatus',
      'read:getResolver',
      'read:hasRoles',
      'read:hasRoles',
      'read:hasRoles',
    ]);
  });

  it('resumes after a crash between steps: only the missing steps are sent', async () => {
    const chain = fakeChain({ failWrite: 'register' });
    await expect(chain.names.ensureCampaignName(input())).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(chain.writes.map((w) => w.functionName)).toEqual(['deployProxy']);
    const out = await chain.names.ensureCampaignName(input());
    expect(out.txs.map((t) => t.step)).toEqual(['register', 'grant']);
    expect(chain.writes.map((w) => w.functionName)).toEqual([
      'deployProxy',
      'register',
      'multicall',
    ]);
  });

  it('keeps its own nonce when the node answers a stale pending count', async () => {
    const chain = fakeChain({ staleNonce: 0 });
    await chain.names.ensureCampaignName(input());
    expect(chain.writes.map((w) => w.nonce)).toEqual([0, 1, 2]);
  });

  it('a fresh process behind the chain moves past "nonce too low" instead of failing', async () => {
    const chain = fakeChain({ staleNonce: 3 });
    chain.setChainNonce(5);
    const out = await chain.names.ensureCampaignName(input());
    expect(out.txs).toHaveLength(3);
    expect(chain.writes.map((w) => w.nonce)).toEqual([5, 6, 7]);
  });

  it('two campaigns at once: one transaction in flight at a time, nonces strictly increasing', async () => {
    const chain = fakeChain({ staleNonce: 0 });
    await Promise.all([
      chain.names.ensureCampaignName(input()),
      chain.names.ensureCampaignName(
        input({ campaignId: `0x${'cd'.repeat(32)}`, slug: 'goa-beach' }),
      ),
    ]);
    expect(chain.maxInFlight).toBe(1);
    const nonces = chain.writes.map((w) => w.nonce);
    expect(nonces).toEqual([...nonces].sort((a, b) => a - b));
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('a label registered to another resolver is a conflict; nothing is sent for it', async () => {
    const chain = fakeChain();
    chain.labels.set('mumbai-airport', { status: 2, resolver: SPONSOR });
    await expect(chain.names.ensureCampaignName(input())).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(chain.writes.map((w) => w.functionName)).toEqual(['deployProxy']);
    expect(await chain.names.isAvailable('mumbai-airport')).toBe(false);
    expect(await chain.names.isAvailable('free-label')).toBe(true);
  });

  it('refuses a bad slug or an ended campaign before any call', async () => {
    const chain = fakeChain();
    await expect(chain.names.ensureCampaignName(input({ slug: 'No' }))).rejects.toMatchObject({
      code: 'invalid_name',
    });
    await expect(
      chain.names.ensureCampaignName(input({ expiresAt: NOW - 1 })),
    ).rejects.toMatchObject({ code: 'invalid_expiry' });
    expect(chain.log).toEqual([]);
  });
});

describe('MockCampaignNames', () => {
  it('same contract as live: three steps once, then nothing; labels held until expiry', async () => {
    let now = NOW;
    const names = new MockCampaignNames({ now: () => now });
    const first = await names.ensureCampaignName(input());
    expect(first.txs.map((t) => t.step)).toEqual(['resolver', 'register', 'grant']);
    expect((await names.ensureCampaignName(input())).txs).toEqual([]);
    expect(await names.isAvailable('mumbai-airport')).toBe(false);
    await expect(
      names.ensureCampaignName(input({ campaignId: `0x${'cd'.repeat(32)}` })),
    ).rejects.toMatchObject({ code: 'conflict' });
    names.failNext = 1;
    await expect(names.ensureCampaignName(input())).rejects.toMatchObject({ code: 'unavailable' });
    now += 8 * 86_400_000;
    expect(await names.isAvailable('mumbai-airport')).toBe(true);
  });
});
