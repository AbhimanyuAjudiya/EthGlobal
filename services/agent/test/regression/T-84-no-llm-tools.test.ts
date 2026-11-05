/**
 * T-84 / red team AG6 — no model ever holds Agent Kit tools. Static: no toolkit adapters, no getTools(), no LangChain
 * in package.json. Dynamic: during a Hedera purchase the Agent Kit is called only from code, only for the HCS receipt,
 * never with a transfer tool; the x402 payload is @x402/hedera's plain TransferTransaction with the fee payer's id.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { inspectHederaTransaction } from '@x402/hedera';
import { describe, expect, it } from 'vitest';

import { AgentKitConsensusLog } from '../../src/payers/hedera.js';
import {
  buyOnce,
  FEE_PAYER,
  harness,
  HEDERA_ACCEPT,
  HEDERA_AGENT,
  HEDERA_PAYOUT,
  hederaPayer,
} from '../helpers.js';

const SRC = join(import.meta.dirname, '..', '..', 'src');

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('T-84 no LLM holds wallet tools (AG6)', () => {
  it('src has no toolkit adapter, no getTools(), no LangChain/AI-SDK/MCP import', async () => {
    const banned =
      /getTools|HederaLangchainToolkit|HederaAIToolkit|hedera-agent-kit-(langchain|ai-sdk|mcp|elizaos|adk)|langchain/;
    for (const file of await sources(SRC))
      expect(await readFile(file, 'utf8'), file).not.toMatch(banned);
  });

  it('package.json depends on no toolkit adapter and no LangChain', async () => {
    const pkg = JSON.parse(await readFile(join(SRC, '..', 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >;
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /hedera-agent-kit-|langchain|^ai$|@ai-sdk\//.test(n))).toEqual([]);
  });

  it('the decision path imports no notifier, LLM or Inference module', async () => {
    for (const name of [
      'tick.ts',
      'buyer.ts',
      'loop.ts',
      'payers/evm.ts',
      'payers/hedera.ts',
      'payers/types.ts',
      'reads.ts',
    ]) {
      const text = await readFile(join(SRC, name), 'utf8');
      expect(text, name).not.toMatch(/from '[^']*(notify|inference|llm|anthropic)[^']*'/);
      expect(text, name).not.toMatch(/\bInference\b/);
    }
  });

  it('the Agent Kit signer is loaded only by a dynamic import in the live branch (never in local mode)', async () => {
    const importers: string[] = [];
    for (const file of await sources(SRC)) {
      const text = await readFile(file, 'utf8');
      if (/@hashgraph\/hedera-agent-kit|payers\/hedera\.js/.test(text))
        importers.push(file.slice(SRC.length + 1));
    }
    expect(importers.sort()).toEqual(['deps.ts', 'payers/hedera.ts']);
    const deps = await readFile(join(SRC, 'deps.ts'), 'utf8');
    expect(deps).not.toMatch(/^import .*payers\/hedera/m);
    expect(deps).toMatch(
      /config\.mode === 'live' && config\.hedera[\s\S]{0,120}await import\('\.\/payers\/hedera\.js'\)/,
    );
  });

  it('a Hedera purchase calls the Agent Kit only for SUBMIT_TOPIC_MESSAGE with code-computed args', async () => {
    const calls: { method: string; args: unknown }[] = [];
    const kit = {
      run: async (method: string, args: unknown) => (
        calls.push({ method, args }),
        JSON.stringify({ raw: { transactionId: '0.0.5005@1.2', topicSequenceNumber: 7 } })
      ),
    };
    const h = await harness({
      api: {
        accepts: [HEDERA_ACCEPT],
        settleHedera: async (_p, req) => ({
          success: true,
          transaction: '0.0.9185802@1793750069.000000001',
          network: req.network,
          payer: HEDERA_AGENT,
        }),
      },
      payers: (evm) => [hederaPayer(), evm],
    });
    h.agent.deps.receipts = new (await import('../../src/receipts.js')).ReceiptWriter({
      consensus: new AgentKitConsensusLog(kit, h.clock.now),
      topic: '0.0.7001',
      uaid: h.agent.uaid,
      now: h.clock.now,
      log: h.log,
    });
    const out = await buyOnce(h);
    expect(out.bought).toMatchObject({ network: 'hedera:testnet', hcsSequence: 7 });
    expect(calls.map((c) => c.method)).toEqual(['submit_topic_message_tool']);
    expect(calls[0]?.args).toMatchObject({ topicId: '0.0.7001' });
    expect(calls.some((c) => /transfer/i.test(c.method))).toBe(false);

    const tx = inspectHederaTransaction(
      (h.api.paid[0]?.payload as { transaction: string }).transaction,
    );
    expect(tx).toMatchObject({
      transactionType: 'T',
      transactionIdAccountId: FEE_PAYER,
      hasNonTransferOperations: false,
      hbarTransfers: [],
    });
    expect(tx.tokenTransfers['0.0.429274']).toEqual(
      expect.arrayContaining([
        { accountId: HEDERA_AGENT, amount: '-400000' },
        { accountId: HEDERA_PAYOUT, amount: '400000' },
      ]),
    );
  });
});
