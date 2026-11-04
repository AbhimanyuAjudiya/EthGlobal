/** T-77 / red team AG7 — the UAID header on every purchase; nothing secret in .agent/; .agent/ is git-ignored. */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { tick } from '../../src/tick.js';
import { harness, KEY, seed, setUsage } from '../helpers.js';

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await allFiles(p) : [p]));
  }
  return out;
}

describe('T-77 agent identity and state hygiene (AG7)', () => {
  it('X-Agent-Uaid on every purchase equals the persisted UAID', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    await tick(h.agent.deps, KEY);
    await setUsage(h.ledger, h.clock.now, 1100);
    await tick(h.agent.deps, KEY);
    const persisted = (await readFile(join(h.stateDir, 'uaid'), 'utf8')).trim();
    expect(h.api.topups.length).toBeGreaterThanOrEqual(4); // 2 × (402 + paid)
    for (const t of h.api.topups) expect(t.headers['x-agent-uaid']).toBe(persisted);
    expect(h.api.topups.every((t) => /^[0-9a-f-]{36}$/.test(t.headers['x-request-id'] ?? ''))).toBe(
      true,
    );
  });

  it('.agent/ holds no private key, no PIN, no LPA and not the entitlement key in clear', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    await tick(h.agent.deps, KEY);
    const files = await allFiles(h.stateDir);
    expect(files.map((f) => f.slice(h.stateDir.length))).toEqual(
      expect.arrayContaining(['/uaid', '/journal.jsonl', '/state.json']),
    );
    for (const f of files) {
      const text = await readFile(f, 'utf8');
      expect(text).not.toContain(KEY);
      expect(text).not.toMatch(
        /ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a/,
      );
      expect(text).not.toMatch(/LPA:1\$/);
      expect(text).not.toMatch(/(?<![0-9a-f])\d{16}(?![0-9])/);
    }
  });

  it('.agent/ is git-ignored', () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..');
    const out = execFileSync(
      'git',
      ['check-ignore', 'services/agent/.agent/journal.jsonl', '.agent/journal.jsonl'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(out.trim().split('\n')).toHaveLength(2);
  });
});
