#!/usr/bin/env node
/** CLI entry: `pnpm --filter @ethglobal/agent start` (or `recharge-agent`). All logic lives in cli.ts. */
import { main } from './cli.js';

main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(2);
  },
);
