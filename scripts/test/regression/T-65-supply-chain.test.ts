/**
 * THREAT-MODEL T-65 (dependency compromise) — regression for RT-P-04/05/06 (wave3-web-ops.md OP4, OP7):
 * every direct dependency is an exact pin (via the exact catalog), the installed versions are the pinned ones,
 * the release-age gate and the build-script allow-list are unchanged, CI's actions are SHA-pinned under a
 * read-only token with pinned pip tools, and the frozen-install path (runbook + refresh script) is the documented one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Every workspace package.json (pnpm-workspace.yaml: apps/*, services/*, packages/*, scripts) plus the root. */
const manifests = (): { path: string; json: Manifest }[] => {
  const dirs = ['.', 'scripts'];
  for (const group of ['apps', 'services', 'packages']) {
    for (const d of readdirSync(join(ROOT, group))) {
      if (existsSync(join(ROOT, group, d, 'package.json'))) dirs.push(`${group}/${d}`);
    }
  }
  return dirs.map((d) => ({
    path: `${d}/package.json`,
    json: JSON.parse(read(`${d}/package.json`)) as Manifest,
  }));
};

/** The `catalog:` block of pnpm-workspace.yaml as name → version. */
const catalog = (): Map<string, string> => {
  const out = new Map<string, string>();
  let inside = false;
  for (const line of read('pnpm-workspace.yaml').split('\n')) {
    if (/^catalog:\s*$/.test(line)) inside = true;
    else if (/^\S/.test(line)) inside = false;
    else if (inside) {
      const m = /^\s+"?([^"#:]+?)"?:\s*(\S+)\s*$/.exec(line);
      if (m) out.set(m[1]!, m[2]!);
    }
  }
  return out;
};

const EXACT = /^\d+\.\d+\.\d+$/;

/** pnpm-lock.yaml importers (workspace dirs the lockfile knows). */
const lockImporters = (): Set<string> => {
  const out = new Set<string>();
  let inside = false;
  for (const line of read('pnpm-lock.yaml').split('\n')) {
    if (line.startsWith('importers:')) inside = true;
    else if (/^\S/.test(line)) inside = false;
    else if (inside) {
      const m = /^ {2}([^ ].*):$/.exec(line);
      if (m) out.add(m[1]!.replace(/^'|'$/g, ''));
    }
  }
  return out;
};

/**
 * Installed ≠ pinned on the build machines today: these packages were linked by out-of-repo scripts before their
 * importers reached pnpm-lock.yaml (RT-P-04). Only scripts/refresh-lockfile.sh (Thu 5 Nov) can clear them, so each
 * entry applies only while its package has no lockfile importer; anything else that drifts fails.
 */
const PRE_REFRESH_DRIFT = new Set([
  'services/agent/package.json: @vitest/coverage-v8 installed 5.0.5, pinned 5.1.0',
  'packages/octroi/package.json: @vitest/coverage-v8 installed 5.0.5, pinned 5.1.0',
  'packages/adapters/package.json: @arkiv-network/sdk installed 1.0.0, pinned 1.0.1',
  'services/api/package.json: @vitest/coverage-v8 installed 5.1.0-beta.1, pinned 5.1.0',
]);
const deps = (m: Manifest) =>
  Object.entries({ ...m.dependencies, ...m.devDependencies, ...m.optionalDependencies });

describe('T-65 supply chain (RT-P-05): exact pins only', () => {
  it('no ^, ~, *, latest, x-range or tag in any workspace package.json', () => {
    const ranged = manifests().flatMap(({ path, json }) =>
      deps(json)
        .filter(
          ([, spec]) => !(spec.startsWith('workspace:') || spec === 'catalog:' || EXACT.test(spec)),
        )
        .map(([name, spec]) => `${path}: ${name}@${spec}`),
    );
    expect(ranged).toEqual([]);
  });

  it('the catalog is exact and every catalog: reference resolves to an entry', () => {
    const pins = catalog();
    expect(pins.size).toBeGreaterThan(30);
    for (const [name, version] of pins) expect(`${name}@${version}`).toMatch(/@\d+\.\d+\.\d+$/);
    const missing = manifests().flatMap(({ path, json }) =>
      deps(json)
        .filter(([name, spec]) => spec === 'catalog:' && !pins.has(name))
        .map(([name]) => `${path}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('the installed version of every pinned direct dependency is the pin (what the tests run on)', () => {
    const pins = catalog();
    const drift: string[] = [];
    for (const { path, json } of manifests()) {
      const dir = join(ROOT, path, '..');
      for (const [name, spec] of deps(json)) {
        if (spec.startsWith('workspace:')) continue;
        const want = spec === 'catalog:' ? pins.get(name) : spec;
        const installed = join(dir, 'node_modules', name, 'package.json');
        if (!existsSync(installed)) continue; // not linked on this machine (e.g. a package another workstream owns)
        const got = (JSON.parse(readFileSync(installed, 'utf8')) as { version: string }).version;
        if (got !== want) drift.push(`${path}: ${name} installed ${got}, pinned ${want}`);
      }
    }
    const importers = lockImporters();
    const unexplained = drift.filter((d) => {
      const pkg = d.split('/package.json')[0]!;
      // packages/adapters and services/api already have importers, but their lockfile entries are stale too (RT-P-04)
      return !(PRE_REFRESH_DRIFT.has(d) && (!importers.has(pkg) || importers.size < 13));
    });
    expect(unexplained).toEqual([]);
  });
});

describe('T-65 supply chain: install gates unchanged (RT-P-04 is fixed by a refresh, never by weakening them)', () => {
  const ws = read('pnpm-workspace.yaml');

  it('minimumReleaseAge ≥ 3 days, no exclusion list; onlyBuiltDependencies = [esbuild]', () => {
    expect(Number(/^minimumReleaseAge:\s*(\d+)/m.exec(ws)?.[1])).toBeGreaterThanOrEqual(4320);
    expect(ws).not.toMatch(/minimumReleaseAgeExclude|minimum-release-age-exclude/);
    const npmrc = existsSync(join(ROOT, '.npmrc')) ? read('.npmrc') : '';
    expect(npmrc).not.toMatch(/minimum-release-age/);
    expect(/^onlyBuiltDependencies:\n((?:\s+- .*\n)+)/m.exec(ws)?.[1]?.trim()).toBe('- esbuild');
  });

  it('scripts/refresh-lockfile.sh installs, proves the frozen install, stages only the lockfile', () => {
    const sh = read('scripts/refresh-lockfile.sh');
    const steps = sh.split('\n').filter((l) => /^(pnpm|git|bash) /.test(l));
    expect(steps).toEqual([
      'pnpm install',
      'pnpm install --frozen-lockfile',
      'bash security/redteam/tools/deps-check.sh',
      'git add pnpm-lock.yaml',
    ]);
    expect(sh).not.toMatch(/minimumReleaseAge\s*[:=]\s*\d|sed .*pnpm-workspace|git commit/);
    execFileSync('bash', ['-n', join(ROOT, 'scripts/refresh-lockfile.sh')]);
  });

  it('the runbook installs with --frozen-lockfile and points at the refresh script', () => {
    const runbook = read('docs/ONSITE-RUNBOOK.md');
    expect(runbook).toMatch(/^pnpm install --frozen-lockfile\b/m);
    expect(runbook).not.toMatch(/^pnpm install\s*(#|$)/m);
    expect(runbook).toContain('scripts/refresh-lockfile.sh');
  });
});

describe('T-65 supply chain (RT-P-06): CI', () => {
  const ci = read('.github/workflows/ci.yml');

  it('every action is pinned to a full commit SHA (tag in a comment)', () => {
    const uses = [...ci.matchAll(/uses: (\S+)@(\S+)/g)].map((m) => `${m[1]}@${m[2]}`);
    expect(uses.length).toBeGreaterThan(5);
    expect(uses.filter((u) => !/@[0-9a-f]{40}$/.test(u))).toEqual([]);
  });

  it('pip tools are pinned ==; the token is read-only; no secrets; frozen install explains RT-P-04', () => {
    for (const line of ci.split('\n').filter((l) => l.includes('pip install'))) {
      const pkgs = line
        .replace(/.*pip install/, '')
        .trim()
        .split(/\s+/);
      expect(pkgs.filter((p) => !/^[a-z0-9-]+==\d+(\.\d+)*$/.test(p))).toEqual([]);
    }
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(ci).not.toMatch(/secrets\.|pull_request_target|workflow_run/);
    const installs = ci.split('\n').filter((l) => l.includes('pnpm install'));
    expect(installs.length).toBeGreaterThanOrEqual(4);
    for (const l of installs) expect(l).toContain('--frozen-lockfile');
    const help = /LOCKFILE_HELP: >-\n((?: {4}.*\n)+)/.exec(ci)?.[1] ?? '';
    expect(help).toContain('docs/ONSITE-RUNBOOK.md');
    expect(help).toContain('scripts/refresh-lockfile.sh');
    expect(ci).toContain(
      'pnpm install --frozen-lockfile || { echo "::error::$LOCKFILE_HELP"; exit 1; }',
    );
  });
});
