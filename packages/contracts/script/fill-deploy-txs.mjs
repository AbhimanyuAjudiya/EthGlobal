#!/usr/bin/env node
// Copies the creation tx hashes of the last `forge script script/Deploy.s.sol --broadcast` run into
// deploy/addresses.<slug>.json → "txs" (a Foundry script cannot see its own tx hashes while it runs).
// With RPC_URL set it also re-reads owner()/pendingOwner() from the chain (run it again after acceptOwnership()),
// so the file never claims a cold owner the chain does not have yet (RT-C-05).
//
//   CHAIN=31337 node script/fill-deploy-txs.mjs                     # pnpm deploy:txs
//   CHAIN=296 RPC_URL=$HEDERA_TESTNET_RPC_URL pnpm deploy:txs       # after acceptOwnership()
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chainId = process.env.CHAIN ?? '31337';
const chains = JSON.parse(readFileSync(join(root, 'deploy/chains.json'), 'utf8'));
const chain = chains[chainId];
if (!chain) throw new Error(`deploy/chains.json has no entry for chain ${chainId}`);

const addressesPath = join(root, `deploy/addresses.${chain.slug}.json`);
const runPath = join(root, `broadcast/Deploy.s.sol/${chainId}/run-latest.json`);
if (!existsSync(runPath)) throw new Error(`no broadcast found at ${runPath}`);

const addresses = JSON.parse(readFileSync(addressesPath, 'utf8'));
const run = JSON.parse(readFileSync(runPath, 'utf8'));
const lower = (a) => (a ?? '').toLowerCase();
const creation = (address) =>
  run.transactions.find(
    (tx) => tx.transactionType === 'CREATE' && lower(tx.contractAddress) === lower(address),
  )?.hash ?? '';

addresses.txs = {
  dataDrop: creation(addresses.dataDrop),
  usdc: chainId === '31337' ? creation(addresses.usdc) : '',
};
if (!addresses.txs.dataDrop)
  throw new Error(`DataDrop ${addresses.dataDrop} not found in ${runPath}`);
if (process.env.RPC_URL) {
  const read = (sig) =>
    execFileSync('cast', ['call', addresses.dataDrop, sig, '--rpc-url', process.env.RPC_URL], {
      encoding: 'utf8',
    }).trim();
  addresses.owner = read('owner()(address)');
  addresses.pendingOwner = read('pendingOwner()(address)');
}
if (addresses.pendingOwner && !/^0x0{40}$/i.test(addresses.pendingOwner)) {
  console.warn(`fill-deploy-txs: ${addresses.pendingOwner} must still call acceptOwnership()`);
}
writeFileSync(addressesPath, `${JSON.stringify(addresses, null, 2)}\n`);
console.log(`fill-deploy-txs: ${addressesPath}`);
console.log(JSON.stringify(addresses, null, 2));
