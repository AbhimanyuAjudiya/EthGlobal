/**
 * `recharge-agent [--once] [--dry-run] [--key <entitlementKey>]` (INTERFACES §8). Flags override AGENT_ONCE,
 * AGENT_DRY_RUN and AGENT_WATCH_KEYS. Exit codes: 0 ok, 1 configuration error, 2 a tick threw during --once.
 */
import { parseArgs } from 'node:util';

import { loadConfig, type AgentConfig } from './config.js';
import { buildAgent, type BuildOptions } from './deps.js';
import { createLogger, type Log } from './log.js';
import { runLoop, runPass } from './loop.js';

export interface CliFlags {
  once: boolean;
  dryRun: boolean;
  keys: string[];
}

export function parseCliArgs(argv: readonly string[]): CliFlags {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      once: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      key: { type: 'string', multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });
  return { once: values.once, dryRun: values['dry-run'], keys: values.key ?? [] };
}

export function applyFlags(config: AgentConfig, flags: CliFlags): AgentConfig {
  return {
    ...config,
    once: config.once || flags.once,
    dryRun: config.dryRun || flags.dryRun,
    ...(flags.keys.length > 0 ? { watchKeys: flags.keys } : {}),
  };
}

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  opts: BuildOptions & { signal?: AbortSignal } = {},
): Promise<number> {
  const log: Log = opts.log ?? createLogger(env.LOG_LEVEL ?? 'info');
  let config: AgentConfig;
  try {
    const flags = parseCliArgs(argv);
    config = applyFlags(
      loadConfig({
        ...env,
        ...(flags.keys.length > 0 ? { AGENT_WATCH_KEYS: flags.keys.join(',') } : {}),
      }),
      flags,
    );
  } catch (error) {
    log.error(
      { event: 'agent.tick', error: error instanceof Error ? error.message : String(error) },
      'agent: bad configuration',
    );
    return 1;
  }
  const agent = await buildAgent(config, { ...opts, log });
  try {
    log.info(
      {
        event: 'agent.tick',
        mode: config.mode,
        uaid: agent.uaid,
        payers: agent.payers.map((p) => p.network),
        dryRun: config.dryRun,
        watchedKeys: config.watchKeys.length,
      },
      'agent: started',
    );
    if (config.once) {
      const pass = await runPass(agent.deps, await agent.keys());
      return pass.errors.length > 0 ? 2 : 0;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    opts.signal?.addEventListener('abort', stop, { once: true });
    if (opts.signal?.aborted) stop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await runLoop({
        deps: agent.deps,
        keys: () => agent.keys(),
        tickMs: config.tickMs,
        log,
        signal: controller.signal,
      });
    } finally {
      opts.signal?.removeEventListener('abort', stop);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
    return 0;
  } finally {
    agent.close();
  }
}
