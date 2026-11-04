/**
 * MODE=local only: the labelled "demo wallet" behind an EIP-1193 transport (lib/wallet.ts `demoProvider`).
 * Keys are derived on the server from DEMO_WALLET_MNEMONIC (the public Anvil test mnemonic, set by the local
 * stack); nothing here is a NEXT_PUBLIC_ value, so no key reaches the browser bundle (T-63). In any other mode,
 * or without the variable, every request answers 404. web never imports @ethglobal/adapters for this.
 */
import { createPublicClient, createWalletClient, http, type Hex, type TypedDataDefinition } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const ROLE_INDEX = { human: 5, sponsor: 3, recipient: 9 } as const;
type Role = keyof typeof ROLE_INDEX;

const notFound = () => Response.json({ error: { code: 4200, message: 'not found' } }, { status: 404 });

function enabled(): string | undefined {
  if (process.env.NEXT_PUBLIC_MODE !== 'local') return undefined;
  const mnemonic = process.env.DEMO_WALLET_MNEMONIC;
  return mnemonic && mnemonic.split(' ').length >= 12 ? mnemonic : undefined;
}

interface Field { name: string; type: string }

/** JSON typed data → viem values: (u)int fields back to bigint, recursively through struct types. */
function revive(types: Record<string, Field[]>, type: string, value: unknown): unknown {
  if (type.endsWith('[]')) return (value as unknown[]).map((v) => revive(types, type.slice(0, -2), v));
  if (/^u?int\d*$/.test(type)) return BigInt(value as string);
  const fields = types[type];
  if (!fields || typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    fields.map((f) => [f.name, revive(types, f.type, (value as Record<string, unknown>)[f.name])]),
  );
}

export async function POST(request: Request) {
  const mnemonic = enabled();
  if (!mnemonic) return notFound();
  const body = (await request.json().catch(() => ({}))) as {
    role?: string;
    method?: string;
    params?: unknown[];
  };
  const role = (body.role ?? '') as Role;
  if (!(role in ROLE_INDEX)) return Response.json({ error: { code: -32602, message: 'unknown role' } }, { status: 400 });
  const account = mnemonicToAccount(mnemonic, { addressIndex: ROLE_INDEX[role] });
  const rpc = process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
  const transport = http(rpc);
  const params = Array.isArray(body.params) ? body.params : [];
  try {
    const method = body.method ?? '';
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return Response.json({ result: [account.address] });
      case 'eth_chainId': {
        const chainId = await createPublicClient({ transport }).getChainId();
        return Response.json({ result: `0x${chainId.toString(16)}` });
      }
      case 'eth_signTypedData_v4': {
        const [from, json] = params as [string, string];
        if (from.toLowerCase() !== account.address.toLowerCase()) throw new Error('wrong account');
        const typed = JSON.parse(json) as TypedDataDefinition & { types: Record<string, Field[]> };
        const { EIP712Domain: _domain, ...types } = typed.types;
        const message = revive(types, typed.primaryType, typed.message);
        const signature = await account.signTypedData({
          domain: typed.domain ?? {},
          types,
          primaryType: typed.primaryType,
          message: message as Record<string, unknown>,
        });
        return Response.json({ result: signature });
      }
      case 'eth_sendTransaction': {
        const [tx] = params as [{ to: Hex; data?: Hex; value?: Hex }];
        const chainId = await createPublicClient({ transport }).getChainId();
        const wallet = createWalletClient({ account, transport });
        const hash = await wallet.sendTransaction({
          to: tx.to,
          ...(tx.data ? { data: tx.data } : {}),
          ...(tx.value ? { value: BigInt(tx.value) } : {}),
          chain: { id: chainId, name: 'anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } },
        });
        return Response.json({ result: hash });
      }
      default: {
        // reads go straight to the local node
        const result = await createPublicClient({ transport }).request({
          method: method as never,
          params: params as never,
        });
        return Response.json({ result });
      }
    }
  } catch (error) {
    return Response.json(
      { error: { code: -32603, message: error instanceof Error ? error.message.split('\n')[0] : 'error' } },
      { status: 500 },
    );
  }
}

export function GET() {
  return enabled() ? Response.json({ roles: Object.keys(ROLE_INDEX) }) : notFound();
}
