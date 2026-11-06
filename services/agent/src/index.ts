#!/usr/bin/env node
/** CLI entry: `pnpm --filter @ethglobal/agent start` (or `recharge-agent`). All logic lives in cli.ts. */
import { main } from './cli.js';
import { safeError } from './log.js';

main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(safeError(error));
    process.exit(2);
  },
);
