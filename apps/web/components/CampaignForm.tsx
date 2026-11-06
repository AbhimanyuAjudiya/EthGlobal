'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Button, Field, Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { api, ApiError } from '../lib/api';
import { contractUrl, explorerName, networkName } from '../lib/env';
import { moneyUsdc } from '../lib/format';
import { useHydrated, useWallet } from '../lib/hooks';
import {
  approveCall,
  createCampaignCall,
  dataDropAddress,
  myCampaigns,
  scopedCampaignId,
  sponsorLogin,
  usdcAddress,
} from '../lib/sponsor';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { isUserRejection, type Wallet } from '../lib/wallet';

import type { ActionEvent } from '../lib/onchain-action';

const USD6 = 1_000_000n;
const DAY_S = 86_400n;

interface Draft {
  name: string;
  budgetUsd: string;
  priceUsd: string;
  orbMb: string;
  documentMb: string;
  maxClaims: string;
  perHour: string;
  validityDays: string;
  expiresDays: string;
}

/** Testnet defaults: ten 1 GB claims at the eSIM's cost, a week long. */
const initial: Draft = {
  name: 'Mumbai Welcome',
  budgetUsd: '12',
  priceUsd: '1.20',
  orbMb: '1000',
  documentMb: '1000',
  maxClaims: '10',
  perHour: '10',
  validityDays: '7',
  expiresDays: '7',
};

/** "0.50" → 500000n; refuses anything but plain decimals with ≤ 6 places. */
function usd6(text: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new Error('amount');
  return BigInt(m[1] ?? '0') * USD6 + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}

async function send(
  wallet: Wallet,
  tx: { to: `0x${string}`; data: `0x${string}` },
  label: string,
  dispatch: (e: ActionEvent) => void,
): Promise<boolean> {
  dispatch({ type: 'start', at: Date.now() });
  let hash: `0x${string}`;
  try {
    hash = await wallet.sendTransaction(tx);
  } catch (e) {
    dispatch(
      isUserRejection(e)
        ? { type: 'rejected' }
        : { type: 'preBroadcastError', reason: 'the wallet could not send the transaction' },
    );
    return false;
  }
  dispatch({ type: 'signed', hash, at: Date.now() });
  return (
    (await followTransaction({
      hash,
      network: wallet.network,
      label,
      reader: wallet.reader,
      dispatch,
    })) === 'finalized'
  );
}

/**
 * `/sponsor` create/fund: CampaignForm → OnchainAction × 2 from the sponsor's wallet (approve, createCampaign)
 * → POST /sponsor signed with SponsorLogin → the audit key shown once with a copy affordance.
 */
export function CampaignForm() {
  const { wallet } = useWallet('sponsor');
  const { openConnectModal } = useConnectModal();
  const approve = useOnchainAction();
  const create = useOnchainAction();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string>();
  const [registered, setRegistered] = useState<{
    id: string;
    auditKey: string;
    name: string;
    network: string;
    contract: string;
  }>();
  const [running, setRunning] = useState(false);

  const hydrated = useHydrated();
  const list = hydrated ? myCampaigns.list() : [];

  const field = (key: keyof Draft, label: string, hint?: string) => (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      value={draft[key]}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      inputMode={key === 'name' ? 'text' : 'decimal'}
      mono={key !== 'name'}
      data-testid={`campaign-${key}`}
    />
  );

  const run = useCallback(async () => {
    if (!wallet) return;
    setError(undefined);
    setRunning(true);
    try {
      const budget = usd6(draft.budgetUsd);
      const price = usd6(draft.priceUsd);
      const block = await wallet.reader.getBlock();
      const expiresAtS = block.timestamp + BigInt(Number(draft.expiresDays)) * DAY_S;
      const id = scopedCampaignId(wallet.address, BigInt(Date.now()));
      const usdc = await usdcAddress(wallet);
      if (
        !(await send(
          wallet,
          { to: usdc, ...approveCall(budget) },
          'approve USDC',
          approve.dispatch,
        ))
      )
        return;
      if (
        !(await send(
          wallet,
          createCampaignCall(id, budget, price, Number(draft.perHour), expiresAtS),
          'createCampaign',
          create.dispatch,
        ))
      )
        return;
      const login = await sponsorLogin(wallet, id);
      const res = await api.registerSponsor({
        campaign: {
          id,
          sponsor: wallet.address,
          name: draft.name.trim(),
          bundleMb: { orb: Number(draft.orbMb), document: Number(draft.documentMb), device: 0 },
          pricePerClaimUsd6: price.toString(),
          maxClaims: Number(draft.maxClaims),
          claimsPerHour: Number(draft.perHour),
          validityDays: Number(draft.validityDays),
          wholesaleUsd6PerGb: '1200000',
          // founder decision 2026-11-06 (T-23): at $1.50 the 80 % bundle-EV rule (octroi size.ts) allows the full 1 GB
          idResaleUsd6: '1500000',
          planId: 'in-1gb-7d',
          network: wallet.network,
          contract: dataDropAddress(),
          expiresAt: Number(expiresAtS) * 1000,
        },
        auth: { issuedAt: login.issuedAt, signature: login.signature },
      });
      myCampaigns.add({ id: res.id, name: draft.name.trim() });
      setRegistered({
        ...res,
        name: draft.name.trim(),
        network: wallet.network,
        contract: dataDropAddress(),
      });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setRunning(false);
    }
  }, [wallet, draft, approve.dispatch, create.dispatch]);

  const network = wallet?.network ?? 'eip155:31337';
  const contractHref = registered && contractUrl(registered.network, registered.contract);
  const contractExplorer = registered && explorerName(registered.network);
  // money says its unit and two decimals, grouped en-IN: "$1,000.00 USDC" (RT design review #9)
  let budgetText = `${draft.budgetUsd} USDC`;
  try {
    budgetText = moneyUsdc(usd6(draft.budgetUsd));
  } catch {
    // a half-typed amount stays as typed
  }

  return (
    <div className="sponsor-create">
      <section aria-label="Your campaigns">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Campaign id</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr className="ghost">
                <td colSpan={2}>
                  Create a campaign — name, budget, bundle size by tier, hourly cap.
                </td>
              </tr>
            ) : (
              list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/sponsor/${c.id}`} prefetch={false}>
                      {c.name}
                    </Link>
                  </td>
                  <td>
                    <Hash value={c.id} kind="campaign id" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      <form
        className="campaign-form"
        aria-labelledby="create-title"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <h2 id="create-title" className="pane__title">
          Create a campaign
        </h2>
        {field('name', 'Name')}
        <div className="form-grid">
          {field('budgetUsd', 'Budget (USDC)')}
          {field(
            'priceUsd',
            'Paid per claim (USDC)',
            'Covers one 1 GB eSIM ($1.20 wholesale); lower prices are refused',
          )}
          {field('orbMb', 'Orb bundle (MB)', 'max 1 GB')}
          {field('documentMb', 'Document bundle (MB)', 'max 1 GB')}
          {field('maxClaims', 'Claims cap')}
          {field('perHour', 'Claims per hour')}
          {field('validityDays', 'Plan validity (days)')}
          {field('expiresDays', 'Campaign ends in (days)')}
        </div>
        {wallet ? (
          <Button type="submit" disabled={running} data-testid="campaign-submit">
            {`Fund ${budgetText} and create`}
          </Button>
        ) : (
          // no second wallet widget: the action itself opens the header's connect modal
          <Button onClick={() => openConnectModal?.()}>Connect wallet to fund and create</Button>
        )}
      </form>
      <ActionView
        row={approve.row}
        now={approve.now}
        title={`Allow the Recharge contract to use up to ${budgetText}`}
        network={network}
        networkLabel={networkName(network)}
        actionLabel="Step 1 of 2"
        blocked="Starts when you create the campaign"
        walletName={wallet?.name ?? 'your wallet'}
        result="Allowance set"
        expectedMs={expectedMsFor(network)}
        className="sponsor-step"
      />
      <ActionView
        row={create.row}
        now={create.now}
        title={`Create the campaign and lock ${budgetText}`}
        network={network}
        networkLabel={networkName(network)}
        actionLabel="Step 2 of 2"
        blocked="Starts after the allowance"
        walletName={wallet?.name ?? 'your wallet'}
        result="Campaign created on chain"
        expectedMs={expectedMsFor(network)}
        className="sponsor-step"
      />
      {error ? (
        <p className="note" role="status">
          {error}
        </p>
      ) : null}
      {registered ? (
        <section className="audit-key" data-testid="audit-key" aria-labelledby="audit-title">
          <h2 id="audit-title" className="pane__title">
            Audit key · shown once
          </h2>
          <p>
            Store it now: it proves which claims belong to this campaign. Recharge will not show it
            again.
          </p>
          <Hash value={registered.auditKey} kind="audit key" />
          <p className="note">
            {'DataDrop contract '}
            <Hash
              value={registered.contract}
              kind="contract address"
              {...(contractHref ? { explorerHref: contractHref } : {})}
              {...(contractExplorer ? { explorerName: contractExplorer } : {})}
            />
          </p>
          <Link
            href={`/sponsor/${registered.id}`}
            className="ui-button"
            data-variant="secondary"
            prefetch={false}
          >
            {`Open ${registered.name}`}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
