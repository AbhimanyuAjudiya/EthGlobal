'use client';

/**
 * MODE=local only (RT-W-12, AUD-09): the visible "demo wallet · Anvil #5" banner. Imported only through the lazy
 * import in components/Shell.tsx (`WalletBanner`), behind a literal `process.env.NEXT_PUBLIC_MODE === 'local'`, so a
 * live bundle carries neither this component's name nor its markup.
 */
import { T } from '../../i18n/lang';
import { demoIndex, type Wallet } from '../wallet';

export default function DemoWalletPanel({ wallet }: { wallet: Wallet }) {
  if (process.env.NEXT_PUBLIC_MODE !== 'local' || wallet.kind !== 'demo') return null;
  return (
    <p className="demo-wallet" role="note" data-testid="demo-wallet">
      <T k="demo.banner" params={{ n: demoIndex(wallet) }} />
      <span className="demo-wallet__addr" data-hash title={wallet.address}>
        {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}
      </span>
    </p>
  );
}
