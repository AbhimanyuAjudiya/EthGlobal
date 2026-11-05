/**
 * On-site Hedera account setup (docs/ONSITE-RUNBOOK.md "Key generation"): for each ECDSA key in the git-ignored
 * .env (API, agent, treasury) and .env.payout (payout), look up the auto-created testnet account behind its EVM alias
 * on the mirror node, write the `0.0.x` id back into .env, associate USDC 0.0.429274 when missing, and create the
 * receipts HCS topic once (HCS_TOPIC_ID). Keys never leave the process: only ids and aliases are printed.
 *
 *   pnpm --filter @ethglobal/scripts exec tsx ../packages/adapters/scripts/hedera-setup.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TokenAssociateTransaction, TopicCreateTransaction } from '@hiero-ledger/sdk';
import { AccountId, Client, PrivateKey, TokenId } from '@x402/hedera';
import { z } from 'zod';

import { HttpError, httpJson } from '@ethglobal/protocol/http';

const ROOT = resolve(import.meta.dirname, '../../..');
const MIRROR = 'https://testnet.mirrornode.hedera.com';
const USDC = '0.0.429274';
const DRY = process.argv.includes('--dry-run');

function readEnv(file: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) m.set(match[1]!, match[2]!);
  }
  return m;
}
function setEnv(file: string, key: string, value: string): void {
  const text = readFileSync(file, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(text)
    ? text.replace(re, `${key}=${value}`)
    : `${text.replace(/\n?$/, '\n')}${key}=${value}\n`;
  if (!DRY) writeFileSync(file, next, { mode: 0o600 });
}

const mirrorAccount = z
  .object({ account: z.string(), balance: z.object({ balance: z.number() }) })
  .loose();
const mirrorTokens = z
  .object({ tokens: z.array(z.object({ token_id: z.string() }).loose()) })
  .loose();
async function mirror<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T> | undefined> {
  try {
    const { data } = await httpJson(`${MIRROR}${path}`, {
      method: 'GET',
      schema,
      timeoutMs: 15_000,
    });
    return data as z.infer<T>;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
}

const envFile = resolve(ROOT, '.env');
const payoutFile = resolve(ROOT, '.env.payout');
const env = readEnv(envFile);
const payout = readEnv(payoutFile);

const roles = [
  {
    name: 'api',
    file: envFile,
    keyVar: 'HEDERA_PRIVATE_KEY',
    idVar: 'HEDERA_ACCOUNT_ID',
    key: env.get('HEDERA_PRIVATE_KEY'),
  },
  {
    name: 'agent',
    file: envFile,
    keyVar: 'AGENT_HEDERA_PRIVATE_KEY',
    idVar: 'AGENT_HEDERA_ACCOUNT_ID',
    key: env.get('AGENT_HEDERA_PRIVATE_KEY'),
  },
  {
    name: 'treasury',
    file: envFile,
    keyVar: 'TREASURY_HEDERA_PRIVATE_KEY',
    idVar: 'TREASURY_HEDERA_ACCOUNT',
    key: env.get('TREASURY_HEDERA_PRIVATE_KEY'),
  },
  {
    name: 'payout',
    file: envFile,
    keyVar: 'PAYOUT_HEDERA_PRIVATE_KEY',
    idVar: 'PAYOUT_HEDERA_ACCOUNT',
    key: payout.get('PAYOUT_HEDERA_PRIVATE_KEY'),
  },
];

let apiOperator: { id: string; key: PrivateKey } | undefined;
for (const role of roles) {
  if (!role.key) {
    console.log(`${role.name}: ${role.keyVar} unset — skipped`);
    continue;
  }
  const key = PrivateKey.fromStringECDSA(role.key);
  const alias = `0x${key.publicKey.toEvmAddress()}`;
  const acct = await mirror(`/api/v1/accounts/${alias}`, mirrorAccount);
  if (!acct) {
    console.log(
      `${role.name}: alias ${alias} has no account yet — fund it at portal.hedera.com/faucet`,
    );
    continue;
  }
  const id = acct.account;
  const hbar = (acct.balance.balance / 1e8).toFixed(2);
  setEnv(role.file, role.idVar, id);
  if (role.name === 'api') apiOperator = { id, key };
  const tokens = await mirror(`/api/v1/accounts/${id}/tokens?token.id=${USDC}`, mirrorTokens);
  const associated = (tokens?.tokens ?? []).some((t) => t.token_id === USDC);
  console.log(
    `${role.name}: ${id} (alias ${alias}, ${hbar} ℏ) USDC ${associated ? 'associated' : 'NOT associated'}`,
  );
  if (!associated && !DRY) {
    const client = Client.forTestnet().setOperator(AccountId.fromString(id), key);
    const tx = await new TokenAssociateTransaction()
      .setAccountId(id)
      .setTokenIds([TokenId.fromString(USDC)])
      .execute(client);
    const receipt = await tx.getReceipt(client);
    console.log(
      `${role.name}: associate ${USDC} → ${receipt.status.toString()} (${tx.transactionId.toString()})`,
    );
    client.close();
  }
}

if (apiOperator && !env.get('HCS_TOPIC_ID')) {
  if (DRY) console.log('hcs: would create the receipts topic with the api account as admin');
  else {
    const client = Client.forTestnet().setOperator(
      AccountId.fromString(apiOperator.id),
      apiOperator.key,
    );
    const tx = await new TopicCreateTransaction()
      .setTopicMemo('recharge receipts')
      .setAdminKey(apiOperator.key.publicKey)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const topic = receipt.topicId?.toString();
    if (!topic) throw new Error('topic create returned no id');
    setEnv(envFile, 'HCS_TOPIC_ID', topic);
    console.log(`hcs: topic ${topic} created (https://hashscan.io/testnet/topic/${topic})`);
    client.close();
  }
} else if (env.get('HCS_TOPIC_ID'))
  console.log(`hcs: topic ${env.get('HCS_TOPIC_ID')} already set`);
