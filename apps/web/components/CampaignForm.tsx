'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import { sponsorRegisterSchema, type SponsorRegister } from '@ethglobal/protocol/schemas';
import { Button, Field, Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { ProofPanel } from './ProofPanel';
import { api, ApiError } from '../lib/api';
import { config, contractUrl, explorerName, networkName } from '../lib/env';
import { moneyUsdc } from '../lib/format';
import { useEnsureChain, useHydrated, useWallet } from '../lib/hooks';
import { buildProof, type Proof, type ProofInput } from '../lib/proof';
import {
  approveCall,
  associateUsdcCall,
  createCampaignCall,
  dataDropAddress,
  myCampaigns,
  htsTokenId,
  isHederaSponsorChain,
  readSponsorFunding,
  scopedCampaignId,
  sponsorLogin,
  usdcAddress,
  type SponsorFunding,
} from '../lib/sponsor';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { caip2, isUserRejection, type Wallet } from '../lib/wallet';

import type { StringKey } from '../i18n/strings';
import type { ActionEvent } from '../lib/onchain-action';

const USD6 = 1_000_000n;
const DAY_S = 86_400n;
const PROGRESS = 'recharge.sponsor.pending';
const associationKey = (wallet: Wallet, token: string) =>
  `recharge.sponsor.association:${wallet.chainId}:${wallet.address.toLowerCase()}:${token.toLowerCase()}`;
interface FundingState {
  identity: string;
  data?: SponsorFunding;
  busy?: boolean;
  error?: string;
  hash?: Hex;
}
interface Progress {
  draft: Draft;
  campaign: SponsorRegister['campaign'];
  budget: string;
  approveHash?: Hex;
  createHash?: Hex;
}
function readProgress(): Progress | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROGRESS) ?? 'null');
    if (!value || typeof value !== 'object' || !('campaign' in value)) return undefined;
    const parsed = sponsorRegisterSchema.shape.campaign.safeParse(value.campaign);
    return parsed.success ? (value as Progress) : undefined;
  } catch {
    return undefined;
  }
}
function saveProgress(progress: Progress): void {
  // Fail before sending funds if this browser cannot retain the operation for recovery.
  localStorage.setItem(PROGRESS, JSON.stringify(progress));
}

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

/** Sends one transaction through its OnchainAction row; the hash once final, else undefined. */
async function send(
  wallet: Wallet,
  tx: { to: `0x${string}`; data: `0x${string}` },
  label: string,
  dispatch: (e: ActionEvent) => void,
  previous: Hex | undefined,
  onBroadcast: (hash: Hex | undefined) => void,
): Promise<string | undefined> {
  dispatch({ type: 'start', at: Date.now() });
  let hash: `0x${string}`;
  try {
    hash = previous ?? (await wallet.sendTransaction(tx));
  } catch (e) {
    dispatch(
      isUserRejection(e)
        ? { type: 'rejected' }
        : { type: 'preBroadcastError', reason: 'the wallet could not send the transaction' },
    );
    return undefined;
  }
  dispatch({ type: 'signed', hash, at: Date.now() });
  try {
    onBroadcast(hash);
  } catch {
    dispatch({
      type: 'uncertain',
      reason:
        'The transaction was sent, but browser storage is full. Save the transaction hash and check it before trying again.',
    });
    return undefined;
  }
  const final = await followTransaction({
    hash,
    network: wallet.network,
    label,
    reader: wallet.reader,
    dispatch,
  });
  if (final === 'failed') onBroadcast(undefined);
  return final === 'finalized' ? hash : undefined;
}

/**
 * `/sponsor` create/fund: CampaignForm → OnchainAction × 2 from the sponsor's wallet (approve, createCampaign)
 * → POST /sponsor signed with SponsorLogin → the audit key shown once with a copy affordance.
 */
export function CampaignForm() {
  const { wallet } = useWallet('sponsor');
  const ensureChain = useEnsureChain();
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
  const [proof, setProof] = useState<Proof>();
  const [resume, setResume] = useState<Progress>();
  const [funding, setFunding] = useState<FundingState>();
  const fundingRound = useRef(0);
  const hedera = isHederaSponsorChain(config.chainId);
  const identity = `${wallet?.address.toLowerCase() ?? ''}:${wallet?.chainId ?? ''}`;
  const currentFunding = funding?.identity === identity ? funding : undefined;
  const association = useOnchainAction();

  const checkFunding = useCallback(
    async (switchChain = false) => {
      if (!wallet || !hedera) return;
      const ticket = ++fundingRound.current;
      setFunding({ identity, busy: true });
      try {
        const sponsor = switchChain ? await ensureChain(wallet, config.chainId) : wallet;
        if (sponsor.chainId !== config.chainId) return;
        const data = await readSponsorFunding(sponsor);
        if (ticket === fundingRound.current)
          setFunding({ identity: `${sponsor.address.toLowerCase()}:${sponsor.chainId}`, data });
        if (data.associated) localStorage.removeItem(associationKey(sponsor, data.token));
      } catch (error) {
        if (ticket === fundingRound.current)
          setFunding({
            identity,
            error: error instanceof Error ? error.message : 'Could not check USDC. Try again.',
          });
      }
    },
    [wallet, hedera, identity, ensureChain],
  );
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (alive && wallet?.chainId === config.chainId && hedera) void checkFunding();
    });
    return () => {
      alive = false;
      fundingRound.current += 1;
    };
  }, [wallet?.chainId, wallet?.address, hedera, checkFunding]);

  const associate = async () => {
    if (!wallet || running || currentFunding?.busy) return;
    const ticket = ++fundingRound.current;
    setFunding({
      identity,
      ...(currentFunding?.data ? { data: currentFunding.data } : {}),
      busy: true,
    });
    association.newRow();
    try {
      const sponsor = await ensureChain(wallet, config.chainId);
      const data = await readSponsorFunding(sponsor);
      if (!data.associated) {
        const storageKey = associationKey(sponsor, data.token);
        const saved = localStorage.getItem(storageKey);
        const prior =
          saved && /^0x[0-9a-f]{64}$/i.test(saved) ? (saved as Hex) : currentFunding?.hash;
        // Confirm browser storage works before asking for a transaction; retain any broadcast hash for retry.
        if (!prior) {
          localStorage.setItem(storageKey, 'preparing');
          localStorage.removeItem(storageKey);
        }
        let hash = prior;
        const confirmed = await send(
          sponsor,
          associateUsdcCall(data.token),
          'associate campaign USDC',
          association.dispatch,
          prior,
          (value) => {
            hash = value;
            if (value) localStorage.setItem(storageKey, value);
            else localStorage.removeItem(storageKey);
          },
        );
        if (!confirmed) {
          if (ticket === fundingRound.current)
            setFunding({
              identity,
              data,
              ...(hash ? { hash } : {}),
              error: hash
                ? 'Association is still being checked. Check the same transaction before trying again.'
                : 'USDC association was not completed.',
            });
          return;
        }
      }
      const verified = await readSponsorFunding(sponsor);
      if (!verified.associated)
        throw new Error(
          'The transaction finished, but USDC is not associated. Refresh and check your wallet.',
        );
      localStorage.removeItem(associationKey(sponsor, verified.token));
      if (ticket === fundingRound.current) setFunding({ identity, data: verified });
    } catch (error) {
      if (ticket === fundingRound.current)
        setFunding({
          identity,
          ...(currentFunding?.data ? { data: currentFunding.data } : {}),
          error: isUserRejection(error)
            ? 'Association cancelled in the wallet.'
            : error instanceof Error
              ? error.message
              : 'Could not associate USDC. Try again.',
        });
    }
  };
  useEffect(() => {
    let alive = true;
    // Hydrate browser-only recovery state after the server-compatible first render.
    queueMicrotask(() => {
      const pending = readProgress();
      if (alive && pending) {
        setResume(pending);
        setDraft(pending.draft);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const hydrated = useHydrated();
  const list = hydrated ? myCampaigns.list() : [];

  const field = (key: keyof Draft, label: string, hint?: string) => (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      value={draft[key]}
      disabled={running || Boolean(resume)}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      inputMode={key === 'name' ? 'text' : 'decimal'}
      mono={key !== 'name'}
      data-testid={`campaign-${key}`}
    />
  );

  const run = useCallback(async () => {
    if (!wallet) return;
    setError(undefined);
    setProof(undefined);
    if (running) return;
    setRunning(true);
    approve.newRow();
    create.newRow();
    // the proof gathers what happened, whichever way the run ends: the transactions, the answer or the error
    const evidence: ProofInput = {};
    const txs: { label: StringKey; hash: string; network: string }[] = [];
    try {
      let progress = readProgress();
      const sponsor = await ensureChain(wallet, config.chainId);
      if (progress && progress.campaign.sponsor.toLowerCase() !== sponsor.address.toLowerCase())
        throw new Error('Reconnect the wallet that started this campaign to resume it.');
      if (!progress) {
        const budget = usd6(draft.budgetUsd);
        const price = usd6(draft.priceUsd);
        const days = Number(draft.expiresDays);
        if (budget <= 0n || price <= 0n || budget < price)
          throw new Error('Budget must cover at least one claim.');
        const advertised = await api.plans();
        const minimum = advertised.sponsor?.minPricePerClaimUsd6;
        const maxDuration = advertised.sponsor?.maxCampaignDurationMs;
        if (minimum === undefined || maxDuration === undefined)
          throw new Error(
            'The sponsor funding terms could not be loaded. Try again before funding.',
          );
        if (price < BigInt(minimum))
          throw new Error(`Each claim must cover at least ${moneyUsdc(minimum)}.`);
        if (!Number.isSafeInteger(days) || days < 1 || days * 86_400_000 > maxDuration)
          throw new Error(
            `Campaign duration must be between 1 and ${Math.floor(maxDuration / 86_400_000)} whole days.`,
          );
        const block = await sponsor.reader.getBlock();
        const campaign = sponsorRegisterSchema.shape.campaign.parse({
          id: scopedCampaignId(sponsor.address, BigInt(Date.now())),
          sponsor: sponsor.address,
          name: draft.name.trim(),
          bundleMb: { orb: Number(draft.orbMb), document: Number(draft.documentMb), device: 0 },
          pricePerClaimUsd6: price.toString(),
          maxClaims: Number(draft.maxClaims),
          claimsPerHour: Number(draft.perHour),
          validityDays: Number(draft.validityDays),
          wholesaleUsd6PerGb: '1200000',
          idResaleUsd6: '1500000',
          planId: 'in-1gb-7d',
          network: sponsor.network,
          contract: dataDropAddress(),
          expiresAt: Number(block.timestamp + BigInt(days) * DAY_S) * 1000,
        });
        await api.validateSponsor(campaign);
        progress = { campaign, draft, budget: budget.toString() };
        saveProgress(progress);
        setResume(progress);
      }
      const active = progress;
      const campaign = active.campaign;
      const id = campaign.id as Hex;
      const budget = BigInt(active.budget);
      // A previously broadcast create must resume its existing receipt even if its funding depleted this wallet.
      if (hedera && !active.createHash) {
        const ready = await readSponsorFunding(sponsor);
        setFunding({
          identity: `${sponsor.address.toLowerCase()}:${sponsor.chainId}`,
          data: ready,
        });
        if (!ready.associated)
          throw new Error('Associate this wallet with campaign USDC before funding.');
        if (ready.balance < budget)
          throw new Error(
            `This wallet has ${moneyUsdc(ready.balance)}. Add ${moneyUsdc(budget - ready.balance)} on ${networkName(sponsor.network)}, then refresh the balance.`,
          );
      }
      const usdc = await usdcAddress(sponsor);
      evidence.network = sponsor.network;
      evidence.contract = { address: campaign.contract, network: sponsor.network };
      const remember = (field: 'approveHash' | 'createHash') => (hash: Hex | undefined) => {
        if (hash) active[field] = hash;
        else delete active[field];
        saveProgress(active);
        setResume({ ...active });
      };
      const approved = await send(
        sponsor,
        { to: usdc, ...approveCall(budget) },
        'approve USDC',
        approve.dispatch,
        active.approveHash,
        remember('approveHash'),
      );
      if (!approved) return;
      txs.push({ label: 'proof.approveTx', hash: approved, network: sponsor.network });
      const created = await send(
        sponsor,
        createCampaignCall(
          id,
          budget,
          BigInt(campaign.pricePerClaimUsd6),
          campaign.claimsPerHour,
          BigInt(campaign.expiresAt / 1000),
        ),
        'createCampaign',
        create.dispatch,
        active.createHash,
        remember('createHash'),
      );
      if (!created) return;
      txs.push({ label: 'proof.createTx', hash: created, network: sponsor.network });
      myCampaigns.add({ id, name: campaign.name });
      const login = await sponsorLogin(sponsor, id);
      let res: { id: string; auditKey: string };
      try {
        res = await api.registerSponsor({
          campaign,
          auth: { issuedAt: login.issuedAt, signature: login.signature },
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'campaign_exists') throw error;
        const existing = await api.sponsor(id, login);
        res = { id, auditKey: existing.auditKey ?? '' };
      }
      localStorage.removeItem(PROGRESS);
      setResume(undefined);
      // the audit key is shown once below; the proof keeps only its first and last characters
      evidence.response = res;
      myCampaigns.add({ id: res.id, name: draft.name.trim() });
      setRegistered({
        ...res,
        name: draft.name.trim(),
        network: sponsor.network,
        contract: dataDropAddress(),
      });
    } catch (e) {
      evidence.error = e;
      setError(
        e instanceof ApiError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setRunning(false);
      if (txs.length || evidence.response || evidence.error !== undefined)
        setProof(buildProof({ ...evidence, txs }));
    }
  }, [wallet, ensureChain, draft, running, approve, create, hedera]);

  // both steps run on DataDrop's chain, whatever chain the wallet is on before it
  const network = caip2(config.chainId);
  const contractHref = registered && contractUrl(registered.network, registered.contract);
  const contractExplorer = registered && explorerName(registered.network);
  // money says its unit and two decimals, grouped en-IN: "$1,000.00 USDC" (RT design review #9)
  let budgetText = `${draft.budgetUsd} USDC`;
  let budgetAmount: bigint | undefined;
  try {
    budgetAmount = usd6(draft.budgetUsd);
    budgetText = moneyUsdc(budgetAmount);
  } catch {
    // a half-typed amount stays as typed
  }
  const fundingBlocked =
    hedera &&
    !resume?.createHash &&
    (!currentFunding?.data?.associated ||
      budgetAmount === undefined ||
      currentFunding.data.balance < budgetAmount ||
      currentFunding.busy === true);

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
      <div className="campaign-builder">
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
          {resume ? (
            <p role="status">
              This campaign is saved on this device. Resume to check its existing transactions and
              finish registration without funding a new campaign.{' '}
              <Hash value={resume.campaign.id} kind="campaign id" />
            </p>
          ) : null}
          {field('name', 'Name')}
          <div className="form-grid">
            {field('budgetUsd', 'Budget (USDC)')}
            {field(
              'priceUsd',
              'Paid per claim (USDC)',
              'Must cover the current minimum cost returned by the data provider',
            )}
            {field('orbMb', 'Orb bundle (MB)', 'max 1 GB')}
            {field('documentMb', 'Document bundle (MB)', 'max 1 GB')}
            {field('maxClaims', 'Claims cap')}
            {field('perHour', 'Claims per hour')}
            {field('validityDays', 'Plan validity (days)')}
            {field('expiresDays', 'Campaign ends in (days)')}
          </div>
          {wallet && hedera ? (
            <section
              className="sheet-row"
              aria-label="Campaign funding readiness"
              data-testid="sponsor-funding"
            >
              <h3 className="pane__title">Campaign funding · {networkName(network)}</h3>
              <p className="note">
                Use this wallet’s USDC on {config.chainId === 296 ? 'Hedera testnet' : 'Hedera'}.
                Base USDC cannot fund this pool. Keep HBAR for the association and campaign
                transaction fees.
              </p>
              <Hash
                value={wallet.address}
                kind="funding wallet"
                explorerHref={`https://hashscan.io/${config.chainId === 296 ? 'testnet' : 'mainnet'}/account/${wallet.address}`}
                explorerName="HashScan"
              />
              {currentFunding?.data ? (
                <>
                  <p className="note">
                    USDC token: {htsTokenId(currentFunding.data.token) ?? currentFunding.data.token}
                  </p>
                  <p role="status">
                    {currentFunding.data.associated
                      ? `USDC associated · balance ${moneyUsdc(currentFunding.data.balance)}`
                      : 'Associate USDC before receiving tokens or funding this campaign.'}
                  </p>
                  {currentFunding.data.associated &&
                  budgetAmount !== undefined &&
                  currentFunding.data.balance < budgetAmount ? (
                    <p className="note">
                      Add {moneyUsdc(budgetAmount - currentFunding.data.balance)} to this wallet on{' '}
                      {config.chainId === 296 ? 'Hedera testnet' : 'Hedera'}, then refresh the
                      balance.
                    </p>
                  ) : null}
                  {!currentFunding.data.associated ? (
                    <Button
                      variant="secondary"
                      disabled={running || currentFunding.busy}
                      onClick={() => void associate()}
                    >
                      {currentFunding.hash
                        ? 'Check association transaction'
                        : currentFunding.busy
                          ? 'Checking association…'
                          : 'Associate USDC'}
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="note">
                  {currentFunding?.busy
                    ? 'Checking USDC association and balance…'
                    : 'Check this wallet’s USDC association and balance before funding.'}
                </p>
              )}
              <Button
                variant="quiet"
                disabled={running || currentFunding?.busy}
                onClick={() => void checkFunding(true)}
              >
                {wallet.chainId === config.chainId
                  ? 'Refresh USDC balance'
                  : 'Switch to Hedera and check funds'}
              </Button>
              {currentFunding?.error ? (
                <p className="note" role="alert">
                  {currentFunding.error}
                </p>
              ) : null}
              {association.row.state !== 'idle' ? (
                <ActionView
                  row={association.row}
                  now={association.now}
                  title="Associate campaign USDC"
                  network={network}
                  networkLabel={networkName(network)}
                  actionLabel="Token setup"
                  blocked=""
                  walletName={wallet.name}
                  result="Association transaction confirmed"
                  expectedMs={expectedMsFor(network)}
                />
              ) : null}
            </section>
          ) : null}
          {wallet ? (
            <Button
              type="submit"
              disabled={running || fundingBlocked}
              data-testid="campaign-submit"
            >
              {resume ? 'Resume this campaign' : `Fund ${budgetText} and create`}
            </Button>
          ) : (
            // no second wallet widget: the action itself opens the header's connect modal
            <Button onClick={() => openConnectModal?.()}>Connect wallet to fund and create</Button>
          )}
        </form>
        <div className="campaign-progress">
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
          <ProofPanel proof={proof} />
          {registered ? (
            <section className="audit-key" data-testid="audit-key" aria-labelledby="audit-title">
              <h2 id="audit-title" className="pane__title">
                Audit key · shown once
              </h2>
              <p>
                Store it now: it proves which claims belong to this campaign. Recharge will not show
                it again.
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
      </div>
    </div>
  );
}
