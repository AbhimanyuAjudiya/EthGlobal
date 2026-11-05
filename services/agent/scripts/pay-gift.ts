// one-off (untracked): prove x402 402 → pay → 201 on eip155:84532 through the remote facilitator with POST /gift,
// paid by the agent EVM key (Base Sepolia USDC, EIP-3009). Prints only non-secret facts.
import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

import { fetchWithPayment } from '@ethglobal/protocol/x402';

import { EvmPayer } from '../src/payers/evm.js';

const api = process.env.AGENT_API_URL ?? 'http://127.0.0.1:8790';
const rpc = process.env.AGENT_EVM_RPC_URL ?? 'https://sepolia.base.org';
const key = process.env.AGENT_EVM_PRIVATE_KEY;
if (!key) throw new Error('AGENT_EVM_PRIVATE_KEY unset (set -a; source .env)');
const account = privateKeyToAccount(key as `0x${string}`);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const payer = await new EvmPayer({
  account,
  publicClient,
  network: 'eip155:84532',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
}).init();
console.log(`payer ${account.address} balance usd6 ${await payer.balanceUsd6()}`);
const names = (process.env.GIFT_NAMES ?? 'vitalik.eth').split(',');
for (const name of names) {
  const body = JSON.stringify({ name, mb: 100, message: 'Recharge live test' });
  const r = await fetchWithPayment({
    fetch,
    url: `${api}/gift`,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    signer: payer,
    now: () => Date.now(),
  });
  const text = await r.response.text();
  console.log(`name=${name} first402=${r.required ? 'yes' : 'no'} status=${r.response.status}`);
  if (r.required) console.log('accepts:', JSON.stringify(r.required.accepts.map((a) => ({ network: a.network, asset: a.asset, amount: a.amount, payTo: a.payTo }))));
  if (r.settlement) console.log('settlement:', JSON.stringify(r.settlement));
  console.log('body:', text.replace(/"pin":"[0-9]+"/, '"pin":"<redacted>"').slice(0, 400));
  if (r.response.status === 201) break;
}
