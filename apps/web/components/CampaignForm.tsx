'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Button, Field, Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { WalletButton } from './Shell';
import { api, ApiError } from '../lib/api';
import { networkName } from '../lib/env';
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

const initial: Draft = {
  name: 'Mumbai Welcome',
  budgetUsd: '1000',
  priceUsd: '0.50',
  orbMb: '300',
  documentMb: '150',
  maxClaims: '2000',
  perHour: '120',
  validityDays: '7',
  expiresDays: '14',
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
  const { wallet, busy, error: walletError, pickInjected, disconnect } = useWallet('sponsor');
  const approve = useOnchainAction();
  const create = useOnchainAction();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string>();
  const [registered, setRegistered] = useState<{ id: string; auditKey: string; name: string }>();
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
          wholesaleUsd6PerGb: '1140000',
          idResaleUsd6: '500000',
          planId: 'in-300mb-7d',
          network: wallet.network,
          contract: dataDropAddress(),
          expiresAt: Number(expiresAtS) * 1000,
        },
        auth: { issuedAt: login.issuedAt, signature: login.signature },
      });
      myCampaigns.add({ id: res.id, name: draft.name.trim() });
      setRegistered({ ...res, name: draft.name.trim() });
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
  // money says its unit and two decimals, grouped en-IN: "$1,000.00 USDC" (RT design review #9)
  let budgetText = `${draft.budgetUsd} USDC`;
  try {
    budgetText = moneyUsdc(usd6(draft.budgetUsd));
  } catch {
    // a half-typed amount stays as typed
  }

  return (
    <div className="sponsor-create">
      <WalletButton
        wallet={wallet}
        busy={busy}
        error={walletError}
        onInjected={(w) => void pickInjected(w)}
        onDisconnect={disconnect}
      />
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
          {field('priceUsd', 'Paid per claim (USDC)')}
          {field('orbMb', 'Orb bundle (MB)', 'max 300')}
          {field('documentMb', 'Document bundle (MB)', 'max 300')}
          {field('maxClaims', 'Claims cap')}
          {field('perHour', 'Claims per hour')}
          {field('validityDays', 'Plan validity (days)')}
          {field('expiresDays', 'Campaign ends in (days)')}
        </div>
        <Button type="submit" disabled={!wallet || running} data-testid="campaign-submit">
          {`Fund ${budgetText} and create`}
        </Button>
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
