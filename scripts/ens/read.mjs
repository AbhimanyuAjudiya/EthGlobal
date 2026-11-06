// Read a campaign name back the way a client would: plain viem on Sepolia.
// viem's sepolia chain uses UR 0xeeee…eeee, which ENS points at UniversalResolverV2 -> no custom path.
// Usage: node scripts/ens/read.mjs [name] [userRegistry]   (viem resolves from scripts/node_modules)
import { createPublicClient, http, labelhash, namehash, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

const name = normalize(process.argv[2] ?? 'spike.re-charge.eth');
const userRegistry = process.argv[3];
const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
});

const keys = [
  'url',
  'avatar',
  'recharge.campaign',
  'recharge.pool',
  'recharge.bundle',
  'recharge.terms',
];
const texts = await Promise.all(
  keys.map((key) => client.getEnsText({ name, key }).catch((e) => `ERR ${e.shortMessage}`)),
);
console.log(`${name}  (namehash ${namehash(name)})`);
keys.forEach((k, i) => console.log(`  text ${k.padEnd(18)} = ${texts[i]}`));
console.log(`  resolver            = ${await client.getEnsResolver({ name })}`);

if (userRegistry) {
  const abi = parseAbi([
    'function getExpiry(uint256 anyId) view returns (uint64)',
    'function getOwner(uint256 anyId) view returns (address)',
  ]);
  const label = name.split('.')[0];
  const id = BigInt(labelhash(label));
  const [expiry, owner] = await Promise.all([
    client.readContract({ address: userRegistry, abi, functionName: 'getExpiry', args: [id] }),
    client.readContract({ address: userRegistry, abi, functionName: 'getOwner', args: [id] }),
  ]);
  console.log(
    `  registry expiry     = ${expiry} (${new Date(Number(expiry) * 1000).toISOString()})`,
  );
  console.log(`  registry owner      = ${owner}`);
}
