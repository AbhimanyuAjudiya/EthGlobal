/**
 * scripts/redteam/run.ts — BUILD-PLAN §4 I-20 / OP5.3 name for the red-team runner. The runner is
 * security/redteam/run-wave.sh (owned by the red team); this forwards its arguments and exit status unchanged.
 *
 *   pnpm --filter @ethglobal/scripts exec tsx redteam/run.ts wave3-ops     # = pnpm redteam wave3-ops
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { cliArgs, ROOT } from '../lib/harness.js';

const result = spawnSync('bash', [join(ROOT, 'security/redteam/run-wave.sh'), ...cliArgs()], {
  cwd: ROOT,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
