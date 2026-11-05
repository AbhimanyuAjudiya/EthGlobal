/**
 * scripts/dump-ledger.ts — the local ledger as the MODE=local API holds it (BUILD-PLAN §4 I-18), for the red team's
 * forbidden-pattern scan (`security/redteam/tools/scan.sh`): no LPA, PIN, nullifier or key may appear in any entity.
 * Reads GET /__local/ledger, a route that exists only when the API runs with MODE=local; it refuses any API whose
 * /healthz is not `mode: 'local'`.
 *
 *   API_URL=http://127.0.0.1:8788 pnpm --filter @ethglobal/scripts exec tsx dump-ledger.ts            # → stdout
 *   pnpm --filter @ethglobal/scripts exec tsx dump-ledger.ts -- --out .e2e/ledger-dump.json           # → file, 0600
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { cliArgs } from './lib/harness.js';
import { apiClient, stackFromEnv } from './lib/stack.js';

const { values: flags } = parseArgs({ args: cliArgs(), options: { out: { type: 'string' } } });
const stack = stackFromEnv();
const api = apiClient(stack);

const health = await api.request('/healthz');
if (health.status !== 200 || health.data.mode !== 'local') {
  console.error(
    `dump-ledger: ${stack.apiUrl} is not a MODE=local API (/healthz mode=${String(health.data.mode)})`,
  );
  process.exit(1);
}
const dump = await api.request('/__local/ledger', { expect: [200] });
const text = `${JSON.stringify({ apiUrl: stack.apiUrl, dumpedAt: new Date().toISOString(), ...dump.data }, null, 2)}\n`;
if (flags.out === undefined) {
  process.stdout.write(text);
} else {
  writeFileSync(flags.out, text, { mode: 0o600 });
  chmodSync(flags.out, 0o600);
  console.log(`dump-ledger: ${String(dump.data.count)} entities → ${flags.out}`);
}
