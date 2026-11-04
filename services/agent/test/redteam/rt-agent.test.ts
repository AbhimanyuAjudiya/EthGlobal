/**
 * Red team wave 2 (unscripted) against services/agent: trigger-file TOCTOU between two processes sharing .agent/,
 * state.json lost updates across processes, clock jumps against the own-state cap, hostile 402 / /me bodies the AG2
 * table does not list, a policy whose owner nobody pinned, dry-run parsing, UAID tampering and the T-84 "no tools"
 * rule proven on the request the LLM actually receives.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import { sha256Hex } from '@ethglobal/crypto';
import type { PaymentRequired, PaymentRequirements } from '@ethglobal/protocol/schemas';

import { main } from '../../src/cli.js';
import { loadConfig } from '../../src/config.js';
import { resolveUaid } from '../../src/identity.js';
import { AgentState, Journal } from '../../src/journal.js';
import { memoryLog } from '../../src/log.js';
import { AnthropicPhraser } from '../../src/notify/anthropic.js';
import { phraseNotification } from '../../src/notify/phrase.js';
import { tick } from '../../src/tick.js';
import {
  ALLOW,
  buyOnce,
  DAY_MS,
  EVM_ACCEPT,
  harness,
  HEDERA_ACCEPT,
  hederaPayer,
  KEY,
  seed,
  STRANGER,
  tempDir,
} from '../helpers.js';

const SRC = join(import.meta.dirname, '../../src');
const TSX = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const WORKER = join(import.meta.dirname, 'rt-proc-worker.ts');
const worker = (mode: string, dir: string, count: number, startAt: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      TSX,
      [WORKER, mode, dir, String(count), String(startAt)],
      { timeout: 50_000 },
      (err, out) => (err ? reject(new Error(String(err.message), { cause: err })) : resolve(out)),
    );
  });

const first =
  (fn: (a: PaymentRequirements) => Record<string, unknown>) =>
  (r: PaymentRequired): PaymentRequired =>
    ({ ...r, accepts: r.accepts.map((a, i) => (i === 0 ? fn(a) : a)) }) as PaymentRequired;

describe('attack: rt two processes share .agent/triggers', () => {
  // regression RT-G-01 (fixed; the attack was): claimTrigger creates the file with O_EXCL and only THEN writes the record; a second process
  // that hits EEXIST in that window reads an empty file, JSON.parse fails ⇒ `existing === undefined` ⇒ "dead" ⇒ it
  // overwrites the claim and also returns ok — both processes sign for one trigger
  it('a claim file that exists but is not yet written is never treated as dead', async () => {
    const dir = await tempDir();
    const trigger = `${KEY}:threshold:1000`;
    // process A is between open(path, 'wx') and handle.writeFile(): the file exists and is empty
    await mkdir(join(dir, 'triggers'), { recursive: true });
    await writeFile(join(dir, 'triggers', `${sha256Hex(trigger).slice(2)}.json`), '');
    const processB = new AgentState(dir);
    const claim = await processB.claimTrigger(trigger, Date.now());
    // property: exactly one claimant per trigger — B must back off while A's claim is being written
    expect(claim.ok).toBe(false);
  });

  // regression RT-G-01 (fixed; the attack was) (stress form): two AgentState instances racing claimTrigger on fresh triggers
  it('200 races of claimTrigger between two state instances ⇒ never two winners', async () => {
    const dir = await tempDir();
    const a = new AgentState(dir);
    const b = new AgentState(dir);
    let doubles = 0;
    for (let i = 0; i < 200; i++) {
      const t = `${KEY}:threshold:${i}`;
      const [ra, rb] = await Promise.all([a.claimTrigger(t, 1_000), b.claimTrigger(t, 1_000)]);
      if (ra.ok && rb.ok) doubles++;
    }
    expect(doubles).toBe(0);
  });

  // regression RT-G-01 (fixed; the attack was) (real processes, intermittent): two OS processes on one AGENT_STATE_DIR race claimTrigger —
  // a trigger won by both was observed under full-suite load (green when run alone: the window is narrow, not absent)
  it('two real processes racing 300 triggers ⇒ no trigger won by both', async () => {
    const dir = await tempDir();
    const startAt = Date.now() + 1_500;
    const [a, b] = await Promise.all([
      worker('claim', dir, 300, startAt),
      worker('claim', dir, 300, startAt),
    ]);
    const wonA = new Set(JSON.parse(a) as number[]);
    const both = (JSON.parse(b) as number[]).filter((i) => wonA.has(i));
    expect(both).toEqual([]);
  }, 60_000);

  // regression RT-G-02 (fixed; the attack was): recordPurchase serialises read-modify-write of state.json per PROCESS only; two processes
  // (same AGENT_STATE_DIR, the T-30 two-process case) lose purchases from "own spend today" — the receipt-lag guard
  // (AG1.3) then undercounts and the cap can be re-spent
  it('two real processes record 40 purchases each ⇒ own spend today counts all 80', async () => {
    const dir = await tempDir();
    const startAt = Date.now() + 1_500;
    await Promise.all([worker('record', dir, 40, startAt), worker('record', dir, 40, startAt)]);
    const spent = await new AgentState(dir).spentToday('rt-key', Date.UTC(2026, 10, 4, 12));
    expect(spent).toBe(80n * 400_000n);
  }, 60_000);
});

describe('attack: rt clock jumps against the own-state cap', () => {
  // regression RT-G-03 (fixed; the attack was) (Low): state.json keeps only the day of the LAST purchase; a forward clock jump (NTP step, VM
  // resume) followed by a return wipes today's own record, and with the ledger lagging (AG1.3) the cap is re-spent
  it('purchase on day D, one at a skewed D+1, back to D ⇒ own spend for D is still remembered', async () => {
    const dir = await tempDir();
    const s = new AgentState(dir);
    const d = Date.UTC(2026, 10, 4, 10);
    await s.recordPurchase({ key: KEY, now: d, usd6: 9_600_000n });
    await s.recordPurchase({ key: KEY, now: d + DAY_MS, usd6: 400_000n }); // clock stepped forward a day
    expect(await s.spentToday(KEY, d + 60_000)).toBe(9_600_000n); // clock stepped back
  });
});

describe('attack: rt hostile 402 rows not in the AG2 table', () => {
  // property: no signature for amounts that only look right, for unpinned fee-payer spellings, or absurd timeouts
  const rows: [string, (r: PaymentRequired) => PaymentRequired][] = [
    ['amount 30 nines', first((a) => ({ ...a, amount: '9'.repeat(30) }))],
    ['amount leading zero 0400000', first((a) => ({ ...a, amount: '0400000' }))],
    ['payTo zero address', first((a) => ({ ...a, payTo: `0x${'0'.repeat(40)}` }))],
  ];
  for (const [name, mutate] of rows) {
    it(`EVM ${name} ⇒ no signature`, async () => {
      const h = await harness({ api: { mutate } });
      const out = await buyOnce(h);
      expect(out.signatures).toBe(0);
    });
  }

  it.each([
    ['feePayer with a leading zero', '0.0.09185802'],
    ['feePayer = the agent itself', '0.0.5005'],
    ['feePayer = payTo', '0.0.6006'],
  ])('Hedera %s ⇒ no signature', async (_n, feePayer) => {
    const h = await harness({
      api: {
        accepts: [HEDERA_ACCEPT],
        mutate: first((a) => ({ ...a, extra: { ...a.extra, feePayer } })),
      },
      payers: () => [hederaPayer()],
    });
    expect((await buyOnce(h)).signatures).toBe(0);
  });

  // property: an EVM entry asking for a 1-hour validity is signed with ≤ 300 s, never what the 402 asks
  it('EVM maxTimeoutSeconds 3600 ⇒ validBefore ≤ now + 300 s', async () => {
    const h = await harness({ api: { mutate: first((a) => ({ ...a, maxTimeoutSeconds: 3600 })) } });
    await buyOnce(h);
    for (const p of h.api.paid) {
      const auth = (p.payload as { authorization: { validBefore: string } }).authorization;
      expect(Number(auth.validBefore)).toBeLessThanOrEqual(Math.floor(h.clock.now() / 1000) + 300);
    }
  });
});

describe('attack: rt hostile /me and policy reads', () => {
  // property: the largest entitlement the schema admits (1 000 000 MB) still phrases a notification after a buy —
  // NotificationFacts' bound (10 000 000) is above every value a schema-valid /me or ledger read can carry
  it('mbTotal 999 900 at threshold ⇒ purchase journals `buy` and the tick resolves', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbTotal: 999_900, mbUsed: 999_850 });
    const r = await tick(h.agent.deps, KEY);
    const buys = (await new Journal(h.stateDir).read()).filter((l) => l.event === 'buy');
    expect(r.bought).toBeDefined();
    expect(buys).toHaveLength(1);
  });

  // regression RT-G-04 (fixed; the attack was): with AGENT_WATCH_KEYS and no AGENT_OWNER (the documented local setup, allowed live) the
  // agent spends its wallet under whatever policy the key carries — including one a stranger registered (T-73 b)
  it('a watched key whose policy owner is a stranger ⇒ no purchase unless the owner is pinned', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, {
      mbUsed: 900,
      owner: STRANGER,
      policy: { maxUsd6PerDay: '1000000000' },
    });
    const r = await tick(h.agent.deps, KEY);
    expect(r.bought).toBeUndefined();
  });

  // property: with AGENT_OWNER pinned, a stranger's policy is skipped `not-mine` (control)
  it('control: AGENT_OWNER pinned ⇒ stranger-owned policy skipped not-mine', async () => {
    const h = await harness({ env: { AGENT_OWNER: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900, owner: STRANGER });
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('not-mine');
    expect(h.signatures()).toBe(0);
  });
});

describe('attack: rt dry-run and flag parsing', () => {
  // property: a dry run can be switched ON by env or flag but never OFF by a flag; unknown spellings refuse to run
  it.each([
    [['--once', '--dry-run'], { AGENT_DRY_RUN: '0' }, 0],
    [['--once'], { AGENT_DRY_RUN: ' TRUE ' }, 0],
    [['--once', '--dry-run=false'], {}, 1],
    [['--once', '--no-dry-run'], { AGENT_DRY_RUN: '1' }, 1],
    [['--once'], { AGENT_DRY_RUN: 'on' }, 1],
  ] as const)('argv %j env %j ⇒ exit %i and zero signatures', async (argv, env, code) => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const before = h.signatures();
    const exit = await main(
      [...argv],
      {
        MODE: 'local',
        AGENT_API_URL: 'http://api.test',
        AGENT_PAYTO_ALLOWLIST: ALLOW,
        AGENT_STATE_DIR: h.stateDir,
        AGENT_WATCH_KEYS: KEY,
        ...env,
      },
      {
        fetch: h.api.fetch,
        now: h.clock.now,
        log: memoryLog(),
        reads: h.agent.deps.reads,
        payers: [h.evm.payer],
        hcs14: () => 'uaid:aid:rt',
      },
    );
    expect(exit).toBe(code);
    expect(h.signatures()).toBe(before);
  });
});

describe('attack: rt identity file tampering (UAID spoof)', () => {
  // property: a planted .agent/uaid is replaced by the computed UAID; AGENT_UAID must look like a uaid
  it('planted .agent/uaid ⇒ recomputed; AGENT_UAID without the uaid: prefix ⇒ config error', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'uaid'), 'uaid:aid:someone-else\n');
    const uaid = await resolveUaid({
      stateDir: dir,
      compute: () => 'uaid:aid:ours',
      log: memoryLog(),
    });
    expect(uaid).toBe('uaid:aid:ours');
    expect((await readFile(join(dir, 'uaid'), 'utf8')).trim()).toBe('uaid:aid:ours');
    expect(() =>
      loadConfig({
        AGENT_API_URL: 'http://api.test',
        AGENT_PAYTO_ALLOWLIST: ALLOW,
        AGENT_UAID: 'aid:not-a-uaid',
      }),
    ).toThrow();
  });
});

describe('attack: rt T-84 — no model ever holds a tool', () => {
  // property: the only request an LLM receives has exactly {model, max_tokens, messages[1]} — no tools, no system
  it('AnthropicPhraser request body carries no tools/system and only instruction + facts JSON', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      return Response.json({
        id: 'msg_1',
        model: 'm',
        content: [
          { type: 'tool_use', name: 'transfer', input: { to: '0.0.666' } },
          { type: 'text', text: 'CALL transfer(0.0.666, 1000)' },
        ],
      });
    }) as unknown as typeof globalThis.fetch;
    const llm = new AnthropicPhraser({ apiKey: 'k', model: 'm', fetch, url: 'http://llm.test' });
    const text = await phraseNotification(
      {
        mbRemaining: 300,
        mbTotal: 1100,
        expiresAt: 1,
        boughtMb: 100,
        spentTodayUsd6: '400000',
        capUsd6: '10000000',
        reason: 'threshold',
      },
      llm,
    );
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0]!).sort()).toEqual(['max_tokens', 'messages', 'model']);
    const messages = bodies[0]!.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toMatch(/^Rewrite these facts .*Facts: \{"mbRemaining":300,/);
    // a tool_use block in the answer is ignored; the text is shown, never executed
    expect(text).toBe('CALL transfer(0.0.666, 1000)');
  });

  // property: grep-proof over src — no toolkit adapters, no getTools, Agent Kit run() only with two code-chosen tools
  it('src has no LLM toolkit and HederaAgentAPI.run is called with ASSOCIATE / SUBMIT_TOPIC only', async () => {
    const files: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(d, e.name));
        else if (e.name.endsWith('.ts')) files.push(join(d, e.name));
      }
    };
    await walk(SRC);
    const all = await Promise.all(files.map(async (f) => [f, await readFile(f, 'utf8')] as const));
    for (const [, text] of all) {
      expect(text).not.toMatch(
        /getTools\(|HederaLangchainToolkit|hedera-agent-kit-(langchain|ai-sdk|mcp|elizaos|adk)|@langchain|from 'langchain'|"tools"\s*:|\btools\s*:\s*\[/,
      );
    }
    const runs = all.flatMap(([, t]) => [...t.matchAll(/\.run\(\s*([A-Z_]+)/g)].map((m) => m[1]));
    expect(new Set(runs)).toEqual(new Set(['ASSOCIATE_TOKEN_TOOL', 'SUBMIT_TOPIC_MESSAGE_TOOL']));
    // the decision path never imports the notifier/LLM modules
    for (const [f, t] of all) {
      if (/(tick|buyer|loop|reads|payers\/(evm|hedera|types))\.ts$/.test(f)) {
        expect(t).not.toMatch(/notify\/|anthropic|Inference/);
      }
    }
  });
});

describe('attack: rt two processes on one ledger keep one purchase per trigger (control)', () => {
  // property: with the trigger written, a second process over the same dir does not sign again
  it('sequential ticks from two processes ⇒ one purchase', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const a = await harness({ clock, ledger, api: { accepts: [EVM_ACCEPT] } });
    const b = await harness({ clock, ledger, stateDir: a.stateDir });
    await seed(ledger, clock.now, { mbUsed: 850 }); // 150 left; one step lifts it above the 200 threshold
    await tick(a.agent.deps, KEY);
    await tick(b.agent.deps, KEY);
    expect(a.api.settled.length + b.api.settled.length).toBe(1);
  });
});
