// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoardingPass } from './BoardingPass';

const NOW = Date.UTC(2026, 10, 8, 8, 32); // Sun 8 Nov 14:02 IST
const CLAIM_BY = Date.UTC(2026, 10, 15, 3, 42); // Sun 15 Nov 09:12 IST
const base = { to: 'rahul.eth', from: 'you', mb: 1000, claimBy: CLAIM_BY } as const;

describe('BoardingPass', () => {
  it('is addressed to the ENS name with the real fields', () => {
    render(<BoardingPass {...base} now={NOW} pin="4821993011275064" serial="7f3a0010" />);
    expect(screen.getByRole('article', { name: 'Gift of 1\u00a0GB to rahul.eth' })).toBeTruthy();
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['To', 'From', 'Data', 'City', 'Valid until']);
    expect(screen.getByText('rahul.eth')).toBeTruthy();
    expect(screen.getByText('MUMBAI')).toBeTruthy();
    expect(screen.getByText('Sun 15 Nov 09:12 IST')).toBeTruthy();
    expect(screen.getByText(/4821 9930 1127 5064/)).toBeTruthy();
  });

  it('counts down as text in a <time> that is not re-announced, never a spinner', () => {
    const { container } = render(<BoardingPass {...base} now={NOW} />);
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('Claim within 6 d 19 h · Sun 15 Nov 09:12 IST');
    expect(time?.getAttribute('aria-live')).toBe('off');
    expect(time?.getAttribute('datetime')).toBe(new Date(CLAIM_BY).toISOString());
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows seconds only in the last hour', () => {
    const { container } = render(<BoardingPass {...base} now={CLAIM_BY - 42 * 60_000 - 10_000} />);
    expect(container.querySelector('time')?.textContent).toMatch(/^Claim within 42 m 10 s/);
  });

  it('closed, lapsed and claimed states', () => {
    const { container, rerender } = render(<BoardingPass {...base} now={CLAIM_BY + 1} />);
    expect(container.querySelector('time')?.textContent).toBe(
      'Claim window closed · Sun 15 Nov 09:12 IST',
    );
    rerender(<BoardingPass {...base} now={CLAIM_BY + 1} status="lapsed" />);
    expect(container.querySelector('time')?.textContent).toMatch(/^Gift lapsed/);
    rerender(<BoardingPass {...base} now={NOW} status="claimed" />);
    expect(screen.getByText('Claimed by rahul.eth')).toBeTruthy();
  });

  it('ticks on its own when no clock is passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIM_BY - 61 * 60_000);
    const { container } = render(<BoardingPass {...base} />);
    expect(container.querySelector('time')?.textContent).toMatch(/^Claim within 1 h 1 m/);
    vi.useRealTimers();
  });
});
