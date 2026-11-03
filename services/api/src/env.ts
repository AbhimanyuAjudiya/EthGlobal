import { z } from 'zod';

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const envSchema = z
  .object({
    /** local = Anvil + mock adapters, no network; live = real RPC and sponsor APIs. */
    MODE: z.enum(['local', 'live']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    /** Chain id served in live mode; local mode is always Anvil (31337). */
    CHAIN: z.coerce.number().int().positive().default(31337),
    RPC_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MODE === 'live' && env.RPC_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['RPC_URL'],
        message: 'RPC_URL is required when MODE=live',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses and validates the environment. Empty strings (as left by .env templates) count as unset. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
