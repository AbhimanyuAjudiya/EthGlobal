'use client';

import { useEffect, useRef, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import { canonicalTicketRefs } from '@ethglobal/protocol/typed-data';
import { Button } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { config } from '../lib/env';
import { useEnsureChain, useWallet } from '../lib/hooks';
import { sponsorTicketsRequest } from '../lib/sponsor';
import { isUserRejection } from '../lib/wallet';

interface Login { sponsor: string; issuedAt: number; signature: Hex }
type TicketStatus = Awaited<ReturnType<typeof api.sponsorTickets>>['tickets'];

/** Passes stay in this mounted organizer view or an explicitly downloaded local file, never a read bearer. */
export function SponsorTickets({
  id,
  sponsor,
  login,
  closed,
}: {
  id: Hex;
  sponsor: string;
  login: Login | undefined;
  closed: boolean;
}) {
  const { t, lang } = useLang();
  const { wallet } = useWallet('sponsor');
  const ensureChain = useEnsureChain();
  const [refs, setRefs] = useState('');
  const [tickets, setTickets] = useState<TicketStatus>([]);
  const [links, setLinks] = useState<{ reference: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [round, setRound] = useState(0);
  const alive = useRef(true);
  const allowed = wallet?.address.toLowerCase() === sponsor.toLowerCase();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!login) return;
    let current = true;
    void api
      .sponsorTickets(id, login)
      .then((response) => {
        if (current) setTickets(response.tickets);
      })
      .catch((error: unknown) => {
        if (current) setError(t(errorKey(error instanceof ApiError ? error.code : 'network')));
      });
    return () => {
      current = false;
    };
  }, [id, login, round, t]);

  const issue = async () => {
    if (!wallet || !allowed || closed || busy) return;
    setError(undefined);
    setCopied(undefined);
    setBusy(true);
    try {
      const references = canonicalTicketRefs(refs.split(/\r?\n/).filter((ref) => ref.trim()));
      const owner = await ensureChain(wallet, config.chainId);
      const request = await sponsorTicketsRequest(owner, id, references);
      const response = await api.issueSponsorTickets(id, request);
      if (!alive.current) return;
      setLinks(
        response.tickets.map((ticket) => ({
          reference: ticket.reference,
          url: `${window.location.origin}/verify?campaign=${encodeURIComponent(id)}#ticket=${encodeURIComponent(ticket.pass)}`,
        })),
      );
      setRound((value) => value + 1);
    } catch (error) {
      if (alive.current && !isUserRejection(error))
        setError(
          error instanceof ApiError
            ? t(errorKey(error.code))
            : t(error instanceof TypeError ? 'tickets.invalidRefs' : 'tickets.failed'),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const copy = async (reference: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      if (alive.current) setCopied(reference);
    } catch {
      if (alive.current) setError(t('tickets.copyFailed'));
    }
  };
  const download = () => {
    const cell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [
      'ticket_reference,private_data_pass',
      ...links.map((link) => `${cell(link.reference)},${cell(link.url)}`),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `private-data-passes-${id.slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <section className="pane" aria-labelledby="tickets-title" lang={lang}>
      <h2 id="tickets-title" className="pane__title">
        {t('tickets.title')}
      </h2>
      <p className="note">{t('tickets.intro')}</p>
      <p className="note">{t('tickets.privacy')}</p>
      <div className="ui-field">
        <label htmlFor="ticket-references" className="ui-field__label">
          {t('tickets.references')}
        </label>
        <textarea
          id="ticket-references"
          className="ui-field__input"
          value={refs}
          maxLength={26000}
          disabled={busy || closed || !allowed}
          style={{ minHeight: '8rem', resize: 'vertical' }}
          onChange={(event) => setRefs(event.target.value)}
          aria-describedby="ticket-ref-hint"
        />
        <p id="ticket-ref-hint" className="ui-field__hint">
          {t('tickets.refHint')}
        </p>
      </div>
      <div className="row-actions">
        <Button disabled={busy || closed || !allowed || !refs.trim()} onClick={() => void issue()}>
          {t(busy ? 'tickets.issuing' : 'tickets.issue')}
        </Button>
        {tickets.length > 0 ? (
          <Button
            variant="quiet"
            disabled={busy || closed || !allowed}
            onClick={() =>
              setRefs(
                tickets
                  .slice(0, 200)
                  .map((ticket) => ticket.reference)
                  .join('\n'),
              )
            }
          >
            {t('tickets.recoverRefs')}
          </Button>
        ) : null}
      </div>
      {closed ? (
        <p role="status">{t('tickets.closed')}</p>
      ) : !allowed ? (
        <p role="status">{t('tickets.ownerNeeded')}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {links.length > 0 ? (
        <div className="sheet-row">
          <p className="note">{t('tickets.distribute')}</p>
          <Button variant="secondary" onClick={download}>
            {t('tickets.export')}
          </Button>
          {links.map((link, index) => (
            <div className="ui-field" key={link.reference}>
              <label className="ui-field__label" htmlFor={`ticket-link-${index}`}>
                {link.reference}
              </label>
              <input
                id={`ticket-link-${index}`}
                className="ui-field__input"
                readOnly
                value={link.url}
                onFocus={(event) => event.target.select()}
              />
              <Button variant="quiet" onClick={() => void copy(link.reference, link.url)}>
                {t(copied === link.reference ? 'tickets.copied' : 'tickets.copy')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <p className="note">{t('tickets.statusHint')}</p>
      {tickets.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table mobile-records">
            <thead>
              <tr>
                <th scope="col">{t('tickets.reference')}</th>
                <th scope="col">{t('tickets.status')}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.reference}>
                  <td data-label={t('tickets.reference')}>{ticket.reference}</td>
                  <td data-label={t('tickets.status')}>
                    {t(ticket.status === 'reserved' ? 'tickets.reserved' : 'tickets.issued')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
