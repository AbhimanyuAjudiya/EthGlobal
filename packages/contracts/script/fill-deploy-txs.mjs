#!/usr/bin/env node
// Copies the creation tx hashes of the last `forge script script/Deploy.s.sol --broadcast` run into
// deploy/addresses.<slug>.json → "txs" (a Foundry script cannot see its own tx hashes while it runs).
// With RPC_URL set it also re-reads owner()/pendingOwner() from the chain (run it again after acceptOwnership()),
// so the file never claims a cold owner the chain does not have yet (RT-C-05).
//
//   CHAIN=31337 node script/fill-deploy-txs.mjs                     # pnpm deploy:txs
//   CHAIN=296 RPC_URL=$HEDERA_TESTNET_RPC_URL pnpm deploy:txs       # after acceptOwnership()
//
// RT-P-12: CHAIN must be a chains.json key, its slug must be [a-z0-9_]+, the file written must resolve inside deploy/,
// and with RPC_URL the endpoint's eth_chainId must equal CHAIN before owner()/pendingOwner() are trusted. Neither
// deploy/ nor the addresses file may be a symlink (lstat), and the file is replaced via a temp file + rename inside
// deploy/, which swaps the directory entry instead of following anything (RT-P-12 verification variant).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const deployDir = resolve(root, 'deploy');
const chainId = process.env.CHAIN ?? '31337';
if (!/^[0-9]{1,12}$/.test(chainId))
  throw new Error(`CHAIN must be a decimal chain id, got ${chainId}`);
const chains = JSON.parse(readFileSync(join(deployDir, 'chains.json'), 'utf8'));
if (!Object.prototype.hasOwnProperty.call(chains, chainId))
  throw new Error(
    `deploy/chains.json has no entry for chain ${chainId} (keys: ${Object.keys(chains).join(', ')})`,
  );
const chain = chains[chainId];
if (typeof chain.slug !== 'string' || !/^[a-z0-9_]+$/.test(chain.slug))
  throw new Error(
    `deploy/chains.json[${chainId}].slug must match [a-z0-9_]+, got ${JSON.stringify(chain.slug)}`,
  );

const addressesPath = resolve(deployDir, `addresses.${chain.slug}.json`);
if (dirname(addressesPath) !== deployDir || !addressesPath.startsWith(deployDir + sep))
  throw new Error(`refusing to write outside deploy/: ${addressesPath}`);
/** A real directory / regular file, never a symlink (whose target could sit anywhere). */
const assertNoLink = (path, kind) => {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw new Error(`refusing a symlinked ${kind}: ${path}`);
  if (kind === 'deploy/' ? !st.isDirectory() : !st.isFile())
    throw new Error(`refusing ${path}: not a regular ${kind === 'deploy/' ? 'directory' : 'file'}`);
};
assertNoLink(deployDir, 'deploy/');
assertNoLink(addressesPath, 'addresses file');
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
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
if (process.env.RPC_URL) {
  const cast = (args) =>
    execFileSync('cast', [...args, '--rpc-url', process.env.RPC_URL], { encoding: 'utf8' }).trim();
  // eth_chainId first: a wrong or hostile RPC must not get to write owner/pendingOwner into the committed file
  const served = cast(['chain-id']);
  if (served !== chainId)
    throw new Error(`RPC_URL serves eth_chainId ${served}, not CHAIN=${chainId}: nothing recorded`);
  const read = (sig) => {
    const value = cast(['call', addresses.dataDrop, sig]);
    if (!ADDRESS.test(value))
      throw new Error(`${sig} returned ${JSON.stringify(value)}, not an address`);
    return value;
  };
  addresses.owner = read('owner()(address)');
  addresses.pendingOwner = read('pendingOwner()(address)');
}
if (addresses.pendingOwner && !/^0x0{40}$/i.test(addresses.pendingOwner)) {
  console.warn(`fill-deploy-txs: ${addresses.pendingOwner} must still call acceptOwnership()`);
}
// temp file inside deploy/ (exclusive create), then rename over the entry: a link planted meanwhile is replaced, not followed
const tmpPath = join(deployDir, `.addresses.${chain.slug}.${randomBytes(6).toString('hex')}.tmp`);
try {
  writeFileSync(tmpPath, `${JSON.stringify(addresses, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  renameSync(tmpPath, addressesPath);
} finally {
  rmSync(tmpPath, { force: true });
}
console.log(`fill-deploy-txs: ${addressesPath}`);
console.log(JSON.stringify(addresses, null, 2));
