'use client';
/**
 * The campaign's ENSv2 name on the sponsor page (ens/README.md): its status, links to the ENS app and Sepolia
 * Etherscan, a QR of the claim link with the name under it (venue posters), and "Edit branding": avatar, description
 * and X handle, which the SPONSOR signs on Sepolia straight to the campaign's own resolver — its EAC lets the
 * sponsor set exactly those three keys, nothing Recharge wrote.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { getAddress } from 'viem';
import { useConfig } from 'wagmi';

import { ENS_SPONSOR_TEXT_KEYS } from '@ethglobal/protocol/ids';
import type { SponsorView } from '@ethglobal/protocol/schemas';
import { Button, Field } from '@ethglobal/ui/components';

import { QrCode } from './QrCode';
import {
  brandingCall,
  ENS_CHAIN_ID,
  ensAppUrl,
  ensClient,
  etherscanAddress,
  etherscanTx,
  xHandle,
} from '../lib/ens';
import { ensureChain } from '../lib/ensure-chain';
import { useWallet } from '../lib/hooks';
import { isUserRejection } from '../lib/wallet';

type Branding = Record<(typeof ENS_SPONSOR_TEXT_KEYS)[number], string>;
const EMPTY: Branding = { avatar: '', description: '', 'com.twitter': '' };

type Save =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'done'; hash: string }
  | { kind: 'error'; message: string; hash?: string };

const STATUS = { pending: 'Registering…', registered: 'Live', failed: 'Not registered' } as const;

export function EnsCampaign({ campaign }: { campaign: SponsorView['campaign'] }) {
  const ens = campaign.ens;
  const { wallet } = useWallet('sponsor');
  const wagmi = useConfig();
  const [saved, setSaved] = useState<Branding>(EMPTY);
  const [draft, setDraft] = useState<Branding>(EMPTY);
  const [save, setSave] = useState<Save>({ kind: 'idle' });
  const live = ens?.status === 'registered' && ens.resolver !== undefined;
  const liveName = live ? ens.name : undefined;

  // the current branding, read from Sepolia (not from our API)
  useEffect(() => {
    if (!liveName) return;
    let alive = true;
    void Promise.all(
      ENS_SPONSOR_TEXT_KEYS.map((key) =>
        ensClient()
          .getEnsText({ name: liveName, key })
          .catch(() => null),
      ),
    ).then((values) => {
      if (!alive) return;
      const current = Object.fromEntries(
        ENS_SPONSOR_TEXT_KEYS.map((key, i) => [key, values[i] ?? '']),
      ) as Branding;
      setSaved(current);
      setDraft(current);
    });
    return () => {
      alive = false;
    };
  }, [liveName]);

  if (!ens) return null;
  const slug = ens.name.split('.')[0] ?? '';
  const claimUrl = `${typeof window === 'undefined' ? '' : window.location.origin}/c/${slug}`;
  const handle = draft['com.twitter'] === '' ? '' : xHandle(draft['com.twitter']);
  const avatarOk = draft.avatar === '' || /^https:\/\/\S{1,240}$/.test(draft.avatar);
  const next: Branding = { ...draft, 'com.twitter': handle ?? '' };
  const changes = ENS_SPONSOR_TEXT_KEYS.filter((key) => next[key] !== saved[key]).map(
    (key) => [key, next[key]] as const,
  );
  const valid = avatarOk && handle !== undefined && draft.description.length <= 280;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!wallet || !ens.resolver || changes.length === 0 || !valid) return;
    try {
      setSave({ kind: 'busy', what: 'Switching the wallet to Sepolia…' });
      await ensureChain(ENS_CHAIN_ID, wagmi);
      setSave({ kind: 'busy', what: 'Confirm in your wallet…' });
      const hash = await wallet.sendTransaction(
        brandingCall(getAddress(ens.resolver), ens.name, changes),
      );
      setSave({ kind: 'busy', what: 'Waiting for Sepolia…' });
      const receipt = await ensClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        setSave({ kind: 'error', message: 'The resolver refused the change.', hash });
        return;
      }
      setSaved(next);
      setDraft(next);
      setSave({ kind: 'done', hash });
    } catch (error) {
      setSave({
        kind: 'error',
        message: isUserRejection(error)
          ? 'Cancelled in the wallet.'
          : 'The wallet could not send it. Is it on Sepolia with a little test ETH?',
      });
    }
  };

  return (
    <section className="pane" aria-labelledby="ens-title" data-testid="ens-campaign">
      <h2 id="ens-title" className="pane__title">
        ENS name · Sepolia
      </h2>
      <p className="ens-campaign__name">
        <span className="mono-key">{ens.name}</span>{' '}
        <span className="ens-status" data-state={ens.status === 'registered' ? 'live' : 'paused'}>
          {STATUS[ens.status]}
        </span>
      </p>
      <p className="note">
        An ENSv2 name in its own registry: owned by your wallet but not transferable, it expires
        with the campaign. Recharge writes the campaign records; you set the branding.
      </p>
      <p className="quiet-rows">
        <a href={ensAppUrl(ens.name)} target="_blank" rel="noreferrer">
          ENS app
        </a>
        {ens.resolver ? (
          <a href={etherscanAddress(ens.resolver)} target="_blank" rel="noreferrer">
            Resolver on Etherscan
          </a>
        ) : null}
        {ens.txs.map((t) => (
          <a key={t.hash} href={etherscanTx(t.hash)} target="_blank" rel="noreferrer">
            {t.step === 'resolver' ? 'Resolver tx' : t.step === 'register' ? 'Name tx' : 'Keys tx'}
          </a>
        ))}
      </p>
      {live ? (
        <>
          <figure>
            <QrCode url={claimUrl} sizeMm={40} label={`Claim link for ${ens.name}`} />
            <figcaption className="mono-key">{ens.name}</figcaption>
          </figure>
          <form onSubmit={(e) => void submit(e)} aria-labelledby="ens-branding-title">
            <h3 id="ens-branding-title" className="pane__title">
              Edit branding
            </h3>
            <Field
              label="Avatar image URL"
              hint="https://…, shown on the claim page"
              value={draft.avatar}
              inputMode="url"
              {...(avatarOk ? {} : { error: 'An https:// image address' })}
              onChange={(e) => setDraft({ ...draft, avatar: e.target.value.trim() })}
            />
            <Field
              label="Description"
              hint="One or two lines for travellers"
              value={draft.description}
              maxLength={280}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <Field
              label="X handle"
              value={draft['com.twitter']}
              {...(handle === undefined ? { error: 'Letters, digits and _ (15 at most)' } : {})}
              onChange={(e) => setDraft({ ...draft, 'com.twitter': e.target.value })}
            />
            <div className="row-actions">
              <Button
                type="submit"
                variant="secondary"
                disabled={!wallet || !valid || changes.length === 0 || save.kind === 'busy'}
              >
                {wallet ? 'Save on Sepolia' : 'Connect the sponsor wallet to save'}
              </Button>
            </div>
            <p className="note" role="status">
              {save.kind === 'busy' ? save.what : null}
              {save.kind === 'error' ? save.message : null}
              {save.kind === 'done' ? 'Saved. ' : null}
              {save.kind === 'done' || (save.kind === 'error' && save.hash) ? (
                <a
                  href={etherscanTx(save.kind === 'done' ? save.hash : (save.hash ?? ''))}
                  target="_blank"
                  rel="noreferrer"
                >
                  View the transaction
                </a>
              ) : null}
            </p>
          </form>
        </>
      ) : null}
    </section>
  );
}
