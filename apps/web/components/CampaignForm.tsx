'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { MAX_BUNDLE_MB, type Hex } from '@ethglobal/protocol/ids';
import {
  sponsorRegisterSchema,
  type CatalogResponse,
  type SponsorRegister,
} from '@ethglobal/protocol/schemas';
import { Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import {
  Button,
  ButtonLink,
  Card,
  ChoiceChips,
  EmptyState,
  Field,
  ListGroup,
  ListRow,
  Notice,
  Section,
  Skeleton,
  StatTile,
  Table,
} from './kit';
import { ProofPanel } from './ProofPanel';
import { useLang } from '../i18n/lang';
import { api, ApiError } from '../lib/api';
import { config, contractUrl, explorerName, networkName } from '../lib/env';
import { formatMb, money, moneyUsdc } from '../lib/format';
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
  pauseCall,
  readSponsorFunding,
  refundCall,
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
const logicalMb = (mb: number) => Math.min(MAX_BUNDLE_MB, Math.floor(mb / 100) * 100);
const supportedPackage = (mb: number) => logicalMb(mb) > 0 && mb <= 1074;
/** 1200000n → "1.20"; all six places only when cents cannot say the amount. */
const usdText = (amount: bigint) => {
  const text = `${amount / USD6}.${(amount % USD6).toString().padStart(6, '0')}`;
  return amount % 10_000n === 0n ? text.slice(0, -4) : text;
};
/** Destinations the catalogue serves today; the two-letter code is what the draft and the API carry. */
const DESTINATIONS = [{ code: 'IN', name: 'India' }] as const;
const PROGRESS = 'recharge.sponsor.pending';
/** Drafts set aside by "Start a new campaign": each names funds locked on chain, so none is ever deleted here. */
const ARCHIVE = 'recharge.sponsor.pending.archive';
/** API answers that no retry of the same draft can change. */
const PERMANENT = new Set(['invalid_request', 'unauthorized']);
const associationKey = (wallet: Wallet, token: string) =>
  `recharge.sponsor.association:${wallet.chainId}:${wallet.address.toLowerCase()}:${token.toLowerCase()}`;
/** The configured DataDrop address, or undefined while MODE=local has no chain yet (the form still renders). */
const configuredContract = (): string | undefined => {
  try {
    return dataDropAddress();
  } catch {
    return undefined;
  }
};
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
  country: string;
  planId: string;
  startsAt: string;
  endsAt: string;
  claimUntil: string;
  reclaimAfter: string;
  reclaimUnused: boolean;
}

/** The provider package and event dates must be chosen explicitly; the destination starts on India. */
const initial: Draft = {
  name: '',
  budgetUsd: '12',
  priceUsd: '1.20',
  orbMb: '1000',
  documentMb: '1000',
  maxClaims: '10',
  perHour: '10',
  validityDays: '7',
  expiresDays: '7',
  country: 'IN',
  planId: '',
  startsAt: '',
  endsAt: '',
  claimUntil: '',
  reclaimAfter: '',
  reclaimUnused: false,
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
  const { t, lang } = useLang();
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
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  /** The API's advertised minimum per claim, fetched with the catalogue to prefill the price (0n: unknown). */
  const [floor, setFloor] = useState(0n);
  /** Once the sponsor types a budget, cap × price stops overwriting it. */
  const [budgetTyped, setBudgetTyped] = useState(false);
  const datesHint = useId();
  const catalogRound = useRef(0);
  const fundingRound = useRef(0);
  const hedera = isHederaSponsorChain(config.chainId);
  const identity = `${wallet?.address.toLowerCase() ?? ''}:${wallet?.chainId ?? ''}`;
  const currentFunding = funding?.identity === identity ? funding : undefined;
  const association = useOnchainAction();
  const pause = useOnchainAction();
  const refund = useOnchainAction();
  const [permanent, setPermanent] = useState(false);
  const selectedPlan =
    catalog?.country === draft.country
      ? catalog.plans.find((plan) => plan.id === draft.planId)
      : undefined;
  // stable: it reads no render state, so the mount effect below runs once
  const loadCatalog = useCallback(async (country: string) => {
    const round = ++catalogRound.current;
    setCatalogBusy(true);
    setCatalogError(undefined);
    setCatalog(undefined);
    setDraft((previous) => ({ ...previous, planId: '', reclaimUnused: false }));
    // the floor only prefills the price: run() reads it again and refuses anything under it
    const minimum = (async () =>
      BigInt((await api.plans()).sponsor?.minPricePerClaimUsd6 ?? 0))().catch(() => 0n);
    try {
      const [response, min] = await Promise.all([api.catalog(country), minimum]);
      if (round === catalogRound.current) {
        setCatalog(response);
        setFloor(min);
      }
    } catch (error) {
      if (round === catalogRound.current)
        setCatalogError(
          error instanceof Error ? error.message : 'Provider plans could not be loaded. Try again.',
        );
    } finally {
      if (round === catalogRound.current) setCatalogBusy(false);
    }
  }, []);

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
      if (!alive) return;
      const pending = readProgress();
      if (pending) {
        setResume(pending);
        setDraft({ ...initial, ...pending.draft });
      } else void loadCatalog(initial.country);
    });
    return () => {
      alive = false;
    };
  }, [loadCatalog]);

  const hydrated = useHydrated();
  // both steps run on DataDrop's chain, whatever chain the wallet is on before it
  const network = caip2(config.chainId);
  // this wallet's campaigns on this deployment only: another wallet's never show in this browser
  const contract = hydrated ? configuredContract() : undefined;
  const list = wallet && contract ? myCampaigns.list(wallet.address, network, contract) : [];

  /** Budget follows claims cap × price until the sponsor types one. */
  const autoBudget = (d: Draft): Draft => {
    if (budgetTyped || !/^\d{1,9}$/.test(d.maxClaims.trim())) return d;
    try {
      return { ...d, budgetUsd: usdText(usd6(d.priceUsd) * BigInt(d.maxClaims.trim())) };
    } catch {
      return d; // a half-typed price leaves the budget as it was
    }
  };
  const choosePlan = (planId: string) => {
    const plan = catalog?.plans.find((item) => item.id === planId);
    if (!plan) return;
    const wholesale = BigInt(plan.wholesaleUsd6);
    const price = floor > wholesale ? floor : wholesale;
    setDraft((previous) =>
      autoBudget({ ...previous, planId, reclaimUnused: false, priceUsd: usdText(price) }),
    );
  };
  const field = (
    key: Exclude<keyof Draft, 'reclaimUnused'>,
    label: string,
    hint?: string,
    type = 'text',
    describedBy?: string,
  ) => (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      value={draft[key]}
      disabled={running || Boolean(resume)}
      onChange={(e) => {
        const value = e.target.value;
        if (key === 'budgetUsd') setBudgetTyped(true);
        setDraft((d) => {
          const next = { ...d, [key]: value };
          return key === 'priceUsd' || key === 'maxClaims' ? autoBudget(next) : next;
        });
      }}
      type={type}
      inputMode={key === 'name' || type === 'datetime-local' ? 'text' : 'decimal'}
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
        if (!selectedPlan || !supportedPackage(selectedPlan.mb))
          throw new Error(t('event.choosePlan'));
        const startsAt = new Date(draft.startsAt).getTime();
        const endsAt = new Date(draft.endsAt).getTime();
        // a blank claim deadline is the event end, as a blank review date is
        const expiresAt = new Date(draft.claimUntil || draft.endsAt).getTime();
        const reclaimAfter = new Date(draft.reclaimAfter || draft.endsAt).getTime();
        if (
          ![startsAt, endsAt, expiresAt, reclaimAfter].every(Number.isFinite) ||
          endsAt <= startsAt ||
          endsAt <= Date.now() ||
          expiresAt <= Date.now() ||
          expiresAt > endsAt ||
          reclaimAfter < endsAt
        )
          throw new Error(t('event.datesInvalid'));
        if (draft.reclaimUnused && selectedPlan.cancellation !== 'never-installed')
          throw new Error(t('event.reclaimUnavailable'));
        if (
          selectedPlan.activation.startsOn === 'unknown' ||
          selectedPlan.activation.installWithinDays === undefined ||
          Date.now() + selectedPlan.activation.installWithinDays * 86_400_000 < endsAt ||
          (draft.reclaimUnused &&
            Date.now() + selectedPlan.activation.installWithinDays * 86_400_000 <
              reclaimAfter + 86_400_000) ||
          selectedPlan.validityDays < Math.ceil((endsAt - startsAt) / 86_400_000) ||
          (selectedPlan.activation.startsOn === 'installation' &&
            Date.now() + selectedPlan.validityDays * 86_400_000 < endsAt)
        )
          throw new Error(t('event.packageDates'));
        if (budget <= 0n || price <= 0n || budget < price)
          throw new Error('Budget must cover at least one claim.');
        const advertised = await api.plans();
        const minimum = advertised.sponsor?.minPricePerClaimUsd6;
        const maxDuration = advertised.sponsor?.maxCampaignDurationMs;
        if (minimum === undefined || maxDuration === undefined)
          throw new Error(
            'The sponsor funding terms could not be loaded. Try again before funding.',
          );
        const floor =
          BigInt(minimum) > BigInt(selectedPlan.wholesaleUsd6)
            ? BigInt(minimum)
            : BigInt(selectedPlan.wholesaleUsd6);
        if (price < floor) throw new Error(t('event.minimumPrice', { price: moneyUsdc(floor) }));
        const block = await sponsor.reader.getBlock();
        if (
          expiresAt <= Number(block.timestamp) * 1000 ||
          expiresAt - Number(block.timestamp) * 1000 > maxDuration
        )
          throw new Error(t('event.maxDuration', { days: Math.floor(maxDuration / 86_400_000) }));
        const campaign = sponsorRegisterSchema.shape.campaign.parse({
          id: scopedCampaignId(sponsor.address, BigInt(Date.now())),
          sponsor: sponsor.address,
          name: draft.name.trim(),
          bundleMb: {
            orb: logicalMb(selectedPlan.mb),
            document: logicalMb(selectedPlan.mb),
            device: 0,
          },
          pricePerClaimUsd6: price.toString(),
          maxClaims: Number(draft.maxClaims),
          claimsPerHour: Number(draft.perHour),
          validityDays: selectedPlan.validityDays,
          wholesaleUsd6PerGb: (
            (BigInt(selectedPlan.wholesaleUsd6) * 1000n + BigInt(logicalMb(selectedPlan.mb)) - 1n) /
            BigInt(logicalMb(selectedPlan.mb))
          ).toString(),
          idResaleUsd6: '1500000',
          planId: selectedPlan.id,
          network: sponsor.network,
          contract: dataDropAddress(),
          expiresAt,
          event: {
            destinationCountry: draft.country,
            startsAt,
            endsAt,
            reclaimAfter,
            ticketRequired: true,
            reclaimUnused: draft.reclaimUnused,
            refundBasis: 'claim-price',
            noticeVersion: 1,
          },
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
      myCampaigns.add({
        id,
        name: campaign.name,
        owner: campaign.sponsor,
        network: campaign.network,
        contract: campaign.contract,
      });
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
      myCampaigns.add({
        id: res.id,
        name: campaign.name,
        owner: campaign.sponsor,
        network: campaign.network,
        contract: campaign.contract,
      });
      setRegistered({
        ...res,
        name: draft.name.trim(),
        network: sponsor.network,
        contract: dataDropAddress(),
      });
    } catch (e) {
      evidence.error = e;
      // the API refuses this funded draft for good (no event terms, another wallet): say what remains of it
      if (e instanceof ApiError && PERMANENT.has(e.code) && readProgress()?.createHash)
        setPermanent(true);
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
  }, [wallet, ensureChain, draft, running, approve, create, hedera, selectedPlan, t]);

  /** Set the saved draft aside (ARCHIVE keeps it: it names locked funds) and open a fresh form. */
  const startNew = () => {
    if (!resume || running) return;
    try {
      const value: unknown = JSON.parse(localStorage.getItem(ARCHIVE) ?? '[]');
      const kept: unknown[] = Array.isArray(value) ? value : [];
      localStorage.setItem(ARCHIVE, JSON.stringify([resume, ...kept].slice(0, 20)));
      localStorage.removeItem(PROGRESS);
    } catch {
      return; // storage refused: the draft stays where it is
    }
    setResume(undefined);
    setPermanent(false);
    setBudgetTyped(false);
    setDraft(initial);
    void loadCatalog(initial.country);
    setError(undefined);
    setProof(undefined);
    approve.newRow();
    create.newRow();
  };
  /** The sponsor wallet pauses or refunds the funded-but-unregistered campaign (DataDrop pause / refund). */
  const recover = async (kind: 'pause' | 'refund') => {
    if (!wallet || !resume?.createHash || running) return;
    const row = kind === 'pause' ? pause : refund;
    setRunning(true);
    setError(undefined);
    row.newRow();
    try {
      const sponsor = await ensureChain(wallet, config.chainId);
      const id = resume.campaign.id as Hex;
      await send(
        sponsor,
        kind === 'pause' ? pauseCall(id, true) : refundCall(id),
        kind === 'pause' ? 'pause campaign' : 'refund campaign',
        row.dispatch,
        undefined,
        () => undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  // a draft funded before event terms were required never registers on the live API; say so before any click
  const unregistrable = Boolean(
    resume && (permanent || (process.env.NEXT_PUBLIC_MODE === 'live' && !resume.campaign.event)),
  );
  let locked: string | undefined;
  try {
    if (resume) locked = moneyUsdc(BigInt(resume.budget));
  } catch {
    // an old draft with no readable budget: the sentence still stands without the amount
  }

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

  // formatMb joins with a no-break space; compare as plain spaces
  const flat = (text: string) => text.replace(/\s+/g, ' ');
  // the package chips name each plan once: the size and days only when the name does not already say them
  const packages = (catalog?.plans ?? [])
    .filter((plan) => supportedPackage(plan.mb))
    .map((plan) => {
      const spec = `${formatMb(logicalMb(plan.mb))} · ${t('offer.days', { days: plan.validityDays })}`;
      const cost = `${money(plan.wholesaleUsd6)} per eSIM`;
      return {
        value: plan.id,
        label: plan.name,
        sub: flat(plan.name).includes(flat(spec)) ? cost : `${spec} · ${cost}`,
        disabled: running,
      };
    });
  const priceParts = [
    floor > 0n ? `floor ${money(floor)}` : undefined,
    selectedPlan ? `provider cost ${money(selectedPlan.wholesaleUsd6)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const priceHint = priceParts
    ? priceParts[0]!.toUpperCase() + priceParts.slice(1)
    : 'Must cover the current minimum cost returned by the data provider';
  let totalLine: string | undefined;
  try {
    if (/^\d{1,9}$/.test(draft.maxClaims.trim())) {
      const price = usd6(draft.priceUsd);
      const total = price * BigInt(draft.maxClaims.trim());
      totalLine = `${draft.maxClaims.trim()} claims × ${money(price)} = ${moneyUsdc(total)}`;
      if (budgetAmount !== undefined && budgetAmount !== total)
        totalLine += ` · budget ${budgetText}`;
    }
  } catch {
    // a half-typed price: no line until it reads as an amount
  }
  const dash = '—';
  const campaignRows = list.map((c) => ({
    id: c.id,
    name: (
      <Link href={`/sponsor/${c.id}`} prefetch={false}>
        {c.name}
      </Link>
    ),
    // the saved list holds names only; status and figures load on the campaign page after sign-in
    status: dash,
    claims: dash,
    spend: dash,
    expires: dash,
  }));
  const perCampaign = 'Opens on each campaign after sign-in';

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Live campaigns"
          value={dash}
          hint={`${list.length} saved in this browser · open one for its status`}
        />
        <StatTile label="Claims today" value={dash} hint={perCampaign} />
        <StatTile label="Spend" value={dash} hint={perCampaign} />
      </div>
      <Section title="Your campaigns" id="campaigns">
        {list.length === 0 ? (
          <Card>
            <EmptyState
              title="No campaigns yet"
              body="Create a campaign — name, destination package, budget, hourly cap."
            />
          </Card>
        ) : (
          <Table
            caption="Your campaigns"
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'status', label: 'Status' },
              { key: 'claims', label: 'Claims', numeric: true },
              { key: 'spend', label: 'Spend / budget', numeric: true },
              { key: 'expires', label: 'Expires' },
            ]}
            rows={campaignRows}
            rowKey={(_, i) => list[i]?.id ?? String(i)}
          />
        )}
      </Section>
      <Card as="section" aria-labelledby="create-title" lang={lang}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <form
            className="grid content-start gap-4"
            aria-labelledby="create-title"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <h2 id="create-title" className="t-heading">
              Create a campaign
            </h2>
            {resume ? (
              <Notice tone="info" role="status">
                This campaign is saved on this device. Resume to check its existing transactions and
                finish registration without funding a new campaign.{' '}
                <Hash value={resume.campaign.id} kind="campaign id" />
              </Notice>
            ) : null}
            {resume && unregistrable ? (
              <Notice
                tone="warning"
                role="region"
                aria-label="Draft cannot be registered"
                data-testid="draft-stuck"
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={running || !resume.createHash}
                      onClick={() => void recover('pause')}
                    >
                      Pause campaign
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={running || !resume.createHash}
                      onClick={() => void recover('refund')}
                    >
                      Refund unspent budget
                    </Button>
                  </div>
                }
              >
                <p role="status">
                  This draft can’t be registered any more: the campaign was funded before event
                  terms were required, so the API refuses it. Its locked budget
                  {locked ? ` (${locked})` : ''} stays in this campaign on chain; the sponsor wallet
                  can refund what is unspent once the campaign has expired, or 24 hours after
                  pausing it. Start a new campaign to fund one with event terms; this draft is kept
                  on this device.
                </p>
              </Notice>
            ) : null}
            <p className="note">{t('event.intro')}</p>
            <Section title="1 · Event">
              <p className="note">Name the campaign and say where the event happens.</p>
              {field('name', 'Name')}
              {!resume ? (
                <div className="ui-field">
                  <label className="ui-field__label" htmlFor="event-destination">
                    Destination
                  </label>
                  <select
                    id="event-destination"
                    className="ui-field__input"
                    value={draft.country}
                    disabled={running}
                    onChange={(e) => {
                      const country = e.target.value;
                      setDraft((previous) => ({ ...previous, country }));
                      void loadCatalog(country);
                    }}
                  >
                    {DESTINATIONS.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </Section>
            <Section title="2 · Package">
              <p className="note">Pick the provider eSIM each attendee receives.</p>
              {resume ? (
                resume.campaign.event ? (
                  <p className="note">
                    {resume.campaign.event.destinationCountry} · {resume.campaign.planId}
                  </p>
                ) : null
              ) : (
                <>
                  {catalogBusy ? (
                    <Skeleton shape="row" count={2} label={t('event.loadingCatalog')} />
                  ) : catalog && packages.length === 0 ? (
                    <EmptyState
                      title="No packages for this destination"
                      body={t('event.noPlans')}
                    />
                  ) : catalog ? (
                    <ChoiceChips
                      label={t('event.package')}
                      options={packages}
                      value={draft.planId || undefined}
                      onChange={choosePlan}
                      data-testid="campaign-package"
                    />
                  ) : null}
                  {catalogError ? (
                    <Notice tone="negative">
                      <p role="alert">{catalogError}</p>
                    </Notice>
                  ) : null}
                  <div>
                    <Button
                      variant="quiet"
                      disabled={running || catalogBusy}
                      onClick={() => void loadCatalog(draft.country)}
                    >
                      Refresh packages
                    </Button>
                  </div>
                  {selectedPlan ? (
                    <Notice tone="info">
                      <p>
                        {t('event.packageTerms', {
                          mb: formatMb(logicalMb(selectedPlan.mb)),
                          days: selectedPlan.validityDays,
                          price: moneyUsdc(selectedPlan.wholesaleUsd6),
                        })}
                      </p>
                      <p>
                        {t(
                          selectedPlan.activation.startsOn === 'first-network'
                            ? 'event.activationNetwork'
                            : selectedPlan.activation.startsOn === 'installation'
                              ? 'event.activationInstall'
                              : 'event.activationUnknown',
                        )}
                      </p>
                      {selectedPlan.activation.installWithinDays ? (
                        <p>
                          {t('event.installWithin', {
                            days: selectedPlan.activation.installWithinDays,
                          })}
                        </p>
                      ) : null}
                    </Notice>
                  ) : null}
                </>
              )}
            </Section>
            <Section title="3 · Dates">
              <p className="note">When the event runs; the package must cover it.</p>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {field('startsAt', t('event.startsAt'), undefined, 'datetime-local', datesHint)}
                {field('endsAt', t('event.endsAt'), undefined, 'datetime-local', datesHint)}
              </div>
              <p id={datesHint} className="ui-field__hint">
                Local time on this device
              </p>
              <details className="grid gap-3">
                <summary className="t-label cursor-pointer">Advanced timing</summary>
                <div className="mt-3 grid items-start gap-4 sm:grid-cols-2">
                  {field(
                    'claimUntil',
                    t('event.claimUntil'),
                    `Leave blank to use the event end. ${t('event.claimHint')}`,
                    'datetime-local',
                  )}
                  {field(
                    'reclaimAfter',
                    t('event.reclaimAfter'),
                    t('event.reclaimDateHint'),
                    'datetime-local',
                  )}
                </div>
              </details>
              <ListGroup label={t('event.reclaimOptIn')}>
                <ListRow
                  title={t('event.reclaimOptIn')}
                  subtitle={
                    selectedPlan?.cancellation === 'never-installed' ||
                    resume?.campaign.event?.reclaimUnused
                      ? 'After the event, never-installed eSIMs are cancelled and the allocation is returned to your wallet.'
                      : selectedPlan
                        ? 'Unavailable: this package’s provider does not cancel never-installed eSIMs.'
                        : 'Choose a package first: only packages that cancel never-installed eSIMs offer this.'
                  }
                  trailing="switch"
                  checked={draft.reclaimUnused}
                  disabled={
                    running || Boolean(resume) || selectedPlan?.cancellation !== 'never-installed'
                  }
                  onCheckedChange={(reclaimUnused) =>
                    setDraft((previous) => ({ ...previous, reclaimUnused }))
                  }
                />
              </ListGroup>
            </Section>
            <Section title="4 · Budget">
              <p className="note">What each claim pays and how many claims the budget funds.</p>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {field('priceUsd', 'Paid per claim (USDC)', priceHint)}
                {field('maxClaims', 'Claims cap')}
                {field('perHour', 'Claims per hour')}
                {field('budgetUsd', 'Budget (USDC)')}
              </div>
              {totalLine ? (
                <p className="note" data-testid="campaign-total">
                  {totalLine}
                </p>
              ) : null}
            </Section>
            <p className="note">{t('event.ticketNotice')}</p>
            {wallet && hedera ? (
              <Notice
                tone="info"
                role="region"
                aria-label="Campaign funding readiness"
                data-testid="sponsor-funding"
                title={`Campaign funding · ${networkName(network)}`}
                action={
                  <Button
                    variant="quiet"
                    disabled={running || currentFunding?.busy}
                    onClick={() => void checkFunding(true)}
                  >
                    {wallet.chainId === config.chainId
                      ? 'Refresh USDC balance'
                      : 'Switch to Hedera and check funds'}
                  </Button>
                }
              >
                <p>
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
                    <p>
                      USDC token:{' '}
                      {htsTokenId(currentFunding.data.token) ?? currentFunding.data.token}
                    </p>
                    <p role="status">
                      {currentFunding.data.associated
                        ? `USDC associated · balance ${moneyUsdc(currentFunding.data.balance)}`
                        : 'Associate USDC before receiving tokens or funding this campaign.'}
                    </p>
                    {currentFunding.data.associated &&
                    budgetAmount !== undefined &&
                    currentFunding.data.balance < budgetAmount ? (
                      <p>
                        Add {moneyUsdc(budgetAmount - currentFunding.data.balance)} to this wallet
                        on {config.chainId === 296 ? 'Hedera testnet' : 'Hedera'}, then refresh the
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
                  <p>
                    {currentFunding?.busy
                      ? 'Checking USDC association and balance…'
                      : 'Check this wallet’s USDC association and balance before funding.'}
                  </p>
                )}
                {currentFunding?.error ? <p role="alert">{currentFunding.error}</p> : null}
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
              </Notice>
            ) : null}
            {wallet ? (
              <Button
                type="submit"
                size="lg"
                block
                disabled={running || fundingBlocked || (!resume && !selectedPlan)}
                data-testid="campaign-submit"
              >
                {resume ? 'Resume this campaign' : `Create campaign · ${budgetText}`}
              </Button>
            ) : (
              // no second wallet widget: the action itself opens the header's connect modal
              <Button size="lg" block onClick={() => openConnectModal?.()}>
                Connect wallet to fund and create
              </Button>
            )}
            {resume ? (
              <Button
                type="button"
                variant="secondary"
                disabled={running}
                onClick={startNew}
                data-testid="campaign-start-new"
              >
                Start a new campaign
              </Button>
            ) : null}
          </form>
          <div className="grid content-start gap-3">
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
              <Notice tone="negative">
                <p role="status">{error}</p>
              </Notice>
            ) : null}
            {pause.row.state !== 'idle' ? (
              <ActionView
                row={pause.row}
                now={pause.now}
                title="Pause this campaign"
                network={network}
                networkLabel={networkName(network)}
                actionLabel="Recovery"
                blocked=""
                walletName={wallet?.name ?? 'your wallet'}
                result="Campaign paused"
                expectedMs={expectedMsFor(network)}
                className="sponsor-step"
              />
            ) : null}
            {refund.row.state !== 'idle' ? (
              <ActionView
                row={refund.row}
                now={refund.now}
                title="Refund the unspent budget"
                network={network}
                networkLabel={networkName(network)}
                actionLabel="Recovery"
                blocked=""
                walletName={wallet?.name ?? 'your wallet'}
                result="Budget refunded to the sponsor wallet"
                expectedMs={expectedMsFor(network)}
                className="sponsor-step"
              />
            ) : null}
            <ProofPanel proof={proof} />
          </div>
        </div>
      </Card>
      {registered ? (
        <Notice
          tone="positive"
          role="region"
          aria-label="Audit key"
          data-testid="audit-key"
          title="Audit key · shown once"
          action={
            <ButtonLink href={`/sponsor/${registered.id}`} variant="secondary">
              {`Open ${registered.name}`}
            </ButtonLink>
          }
        >
          <p>
            Store it now: it proves which claims belong to this campaign. Recharge will not show it
            again.
          </p>
          <Hash value={registered.auditKey} kind="audit key" />
          <p>
            {'DataDrop contract '}
            <Hash
              value={registered.contract}
              kind="contract address"
              {...(contractHref ? { explorerHref: contractHref } : {})}
              {...(contractExplorer ? { explorerName: contractExplorer } : {})}
            />
          </p>
        </Notice>
      ) : null}
    </>
  );
}
