/**
 * The World ID Agent Pass checkpoint (docs/WORLD_AGENT_PASS.md): the API's 403 pass_required pauses the buy; the
 * agent prints the one human line, journals and HCS-notes it, polls, and resumes only on `approved`. Denied and
 * expired are skips with no payload signed; `--once` (runPass) exits cleanly either way.
 */
import { describe, expect, it } from 'vitest';

import { harness, hcsMessages, KEY, seed, skips } from './helpers.js';
import { Journal } from '../src/journal.js';
import { runPass } from '../src/loop.js';
import { tick } from '../src/tick.js';

const journalOf = async (dir: string) => new Journal(dir).read();

describe('World ID Agent Pass checkpoint', () => {
  it('403 pass_required → start → human approves → poll approved → the buy resumes', async () => {
    const h = await harness({ api: { pass: { outcomes: ['pending', 'approved'] } } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const r = await tick(h.agent.deps, KEY);
    expect(r.bought).toMatchObject({ mb: 100, usd6: 400_000n });
    expect(h.api.passCalls).toEqual(['start', 'poll', 'poll']);
    // 403 (no 402 was issued), then the 402 and the paid request
    expect(h.api.topups).toHaveLength(3);
    expect(h.api.paid).toHaveLength(1);
    expect(h.signatures()).toBe(1);
    const line = h.log.lines.find((l) => l.obj.event === 'agent.pass');
    expect(line?.msg).toBe(
      'agent-pass: open https://auth.world.org/device?user_code=ABCD-1234 (code ABCD-1234) within 300s',
    );
    const journal = await journalOf(h.stateDir);
    expect(journal.filter((l) => l.event === 'pass').map((l) => l.state)).toEqual([
      'pending',
      'approved',
    ]);
    const notes = hcsMessages(h).filter((m) => m.t === 'agent-pass');
    expect(notes.map((m) => m.state)).toEqual(['pending', 'approved']);
    expect(notes[0]).toMatchObject({ code: 'ABCD-1234', svc: 'agent' });
    expect(JSON.stringify(notes)).not.toContain('https://');
  });

  it('denied: nothing is signed, agent.skip pass_denied is journaled, the trigger is free again', async () => {
    const h = await harness({ api: { pass: { outcomes: ['denied'] } } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const r = await tick(h.agent.deps, KEY);
    expect(r.skipped).toBe('pass_denied');
    expect(h.api.paid).toHaveLength(0);
    expect(h.signatures()).toBe(0);
    expect(skips(h).at(-1)).toMatchObject({ reason: 'pass_denied' });
    expect((await journalOf(h.stateDir)).at(-1)).toMatchObject({
      event: 'skip',
      skipped: 'pass_denied',
    });
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'agent-pass', state: 'denied' });
    // the next tick asks again (no stale 'trigger-in-flight'); with nobody acting the wait is bounded
    h.clock.advance(5_000);
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('pass_expired');
    expect(h.api.paid).toHaveLength(0);
  });

  it('expired: a --once pass returns without an error, the skip journaled, nothing bought', async () => {
    const h = await harness({ api: { pass: { outcomes: ['pending', 'expired'] } } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const pass = await runPass(h.agent.deps, [KEY]);
    expect(pass.errors).toEqual([]);
    expect(pass.results[0]?.skipped).toBe('pass_expired');
    expect(h.api.paid).toHaveLength(0);
    expect(skips(h).at(-1)).toMatchObject({ reason: 'pass_expired' });
    expect((await journalOf(h.stateDir)).at(-1)).toMatchObject({ skipped: 'pass_expired' });
  });

  it('AGENT_DRY_RUN never starts a checkpoint', async () => {
    const h = await harness({
      env: { AGENT_DRY_RUN: '1' },
      api: { pass: { outcomes: ['approved'] } },
    });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('dry-run');
    expect(h.api.passCalls).toEqual([]);
    expect(h.api.topups).toHaveLength(0);
  });
});
