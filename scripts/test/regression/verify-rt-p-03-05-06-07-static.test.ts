/**
 * Red-team verification variants for the static ops findings (each beyond what its regression enumerates):
 *   RT-P-03 — every Playwright config's RESOLVED output dirs (outputDir or the default <configDir>/test-results and
 *             playwright-report) are git-ignored; raw captures at any fixtures/ depth are ignored.
 *   RT-P-05 — every TRACKED package.json (not only the workspace globs: nested apps/web/e2e, apps/web/test/redteam)
 *             pins exactly; no git/url/file/link dependency; no pnpm.overrides / resolutions range.
 *   RT-P-06 — no job escalates `permissions:` to write; no `run:` pipes a download into a shell or runs `@latest`;
 *             foundry and python versions are pinned.
 *   RT-P-07 — EVERY upload-artifact step is gated on a scan step's success (not only the two the regression names).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const git = (...args: string[]) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const tracked = (pattern: string) =>
  git('ls-files', pattern)
    .stdout.split('\n')
    .filter((f) => f && !f.includes('node_modules'));
const ignored = (p: string) => git('check-ignore', '-q', p).status === 0;
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

describe('verify RT-P-03: resolved Playwright outputs and deep raw captures are ignored', () => {
  it('every playwright config: outputDir (or default test-results) and playwright-report are git-ignored', () => {
    const configs = tracked('*playwright*.config.ts');
    expect(configs.length).toBeGreaterThanOrEqual(2);
    const notIgnored: string[] = [];
    for (const c of configs) {
      const text = readFileSync(join(ROOT, c), 'utf8');
      const dir = dirname(c);
      const outs: string[] = [];
      // playwright-report / blob-report exist only with the html / blob reporter
      if (/['"]html['"]/.test(text)) outs.push(join(dir, 'playwright-report', 'index.html'));
      if (/['"]blob['"]/.test(text)) outs.push(join(dir, 'blob-report', 'x.zip'));
      if (/outputDir:\s*path\.join\(repoRoot, '\.e2e'/.test(text))
        outs.push('.e2e/playwright/x/trace.zip');
      else if (/outputDir:\s*path\.join\(process\.env\.RT_OUT/.test(text))
        outs.push('.e2e/playwright-redteam/x');
      else if (!text.includes('outputDir')) outs.push(join(dir, 'test-results', 'x', 'trace.zip'));
      else notIgnored.push(`${c}: unrecognised outputDir — extend this test`);
      for (const o of outs) if (!ignored(relative('.', o))) notIgnored.push(`${c} → ${o}`);
    }
    expect(notIgnored).toEqual([]);
  });

  it.each([
    'fixtures/live-top.raw.json',
    'fixtures/a/b/c/d/live-deep.raw.json',
    'fixtures/reseller/esimaccess/live-order.v2.raw.json',
    'apps/web/test-results/deep/nested/trace.zip',
    'apps/web/playwright-report/data/0123abcd.zip',
  ])('git check-ignore %s', (p) => {
    expect(ignored(p)).toBe(true);
  });
});

describe('verify RT-P-05: every tracked manifest pins exactly', () => {
  const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  it('no range, tag, git, url, file or link spec in any tracked package.json; no override ranges', () => {
    const bad: string[] = [];
    for (const f of tracked('*package.json')) {
      const m = JSON.parse(readFileSync(join(ROOT, f), 'utf8')) as Record<string, unknown>;
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const [name, spec] of Object.entries((m[section] ?? {}) as Record<string, string>)) {
          if (!(spec.startsWith('workspace:') || spec === 'catalog:' || EXACT.test(spec)))
            bad.push(`${f} ${section}: ${name}@${spec}`);
        }
      }
      const pnpm = (m.pnpm ?? {}) as Record<string, unknown>;
      for (const [name, spec] of Object.entries({
        ...((pnpm.overrides ?? {}) as Record<string, string>),
        ...((m.resolutions ?? {}) as Record<string, string>),
        ...((m.overrides ?? {}) as Record<string, string>),
      })) {
        if (typeof spec !== 'string' || !EXACT.test(spec))
          bad.push(`${f} override: ${name}@${String(spec)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no named catalogs with ranges (catalogs:) in pnpm-workspace.yaml', () => {
    const ws = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    const lines = ws
      .split('\n')
      .filter((l) => /^\s{2,}\S.*:\s*\S/.test(l) && !l.trim().startsWith('#'));
    expect(lines.filter((l) => /:\s*['"]?[\^~*]|:\s*['"]?latest/.test(l))).toEqual([]);
  });
});

describe('verify RT-P-06: CI least privilege and pinned tools beyond actions', () => {
  it('no job-level permissions grant write', () => {
    expect(ci.match(/^\s+[a-z-]+:\s*write\b/gm) ?? []).toEqual([]);
    expect(ci).not.toMatch(/permissions:\s*write-all/);
  });

  it('no run step pipes a download into a shell, runs @latest, or runs an unpinned package via dlx', () => {
    const runs = ci.split('\n').filter((l) => /\brun:|^\s{10,}\S/.test(l));
    const bad = runs.filter(
      (l) =>
        /(curl|wget)[^|]*\|\s*(ba|z)?sh/.test(l) ||
        /@latest\b/.test(l) ||
        /\b(npx|pnpm dlx|bunx)\s+(?!--no-install)[a-z@]/.test(l),
    );
    expect(bad).toEqual([]);
  });

  it('every foundry-toolchain step pins an exact version; setup-python pins a version', () => {
    const foundry = ci.split('foundry-rs/foundry-toolchain@').slice(1);
    expect(foundry.length).toBeGreaterThan(0);
    for (const block of foundry) expect(block.slice(0, 200)).toMatch(/version:\s*v\d+\.\d+\.\d+/);
    expect(ci).toMatch(/python-version:\s*"?\d+\.\d+/);
  });
});

describe('verify RT-P-07: every artefact upload is gated on a clean scan', () => {
  it('each upload-artifact step has an if: naming a scan step outcome == success', () => {
    const steps = ci.split(/\n\s+- (?=name:|uses:|run:|id:|if:)/);
    const uploads = steps.filter((s) => s.includes('actions/upload-artifact@'));
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    for (const u of uploads) expect(u).toMatch(/if:\s*\$\{\{[^}]*steps\.\w+\.outcome == 'success'/);
  });
});
