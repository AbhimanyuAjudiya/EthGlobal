// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProofPanel } from '../components/ProofPanel';
import { SiteMenu } from '../components/Shell';
import { buildProof } from '../lib/proof';

const LPA = 'LPA:1$smdp.example.test$K2-ACTIVATION-CODE-0001';
const PIN = '4111222233334444';
const TX = `0x${'5'.repeat(64)}`;
const ENTITY = `0x${'ab'.repeat(32)}`;
const PAYER = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

const proof = buildProof({
  response: {
    giftId: `0x${'1'.repeat(64)}`,
    pin: PIN,
    lpa: LPA,
    name: 'rahul.eth',
    to: PAYER,
    mb: 1000,
    claimBy: Date.UTC(2026, 10, 13, 3, 42),
    receipt: { arkivKey: ENTITY, hcs: { topic: '0.0.6006', sequence: 7 } },
  },
  status: 200,
  x402: {
    accepted: {
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amount: '4000000',
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      maxTimeoutSeconds: 300,
    },
    settlement: { success: true, transaction: TX, network: 'eip155:84532', payer: PAYER },
  },
  ens: { name: 'rahul.eth', address: PAYER },
});

describe('ProofPanel', () => {
  it('shows the evidence by partner with explorer links and the redacted raw response; the menu switch turns it off', () => {
    render(
      <>
        <SiteMenu />
        <ProofPanel proof={proof} fallback={<p>proof links only</p>} />
      </>,
    );
    const panel = screen.getByTestId('proof-panel');
    expect(panel.querySelector('summary')?.textContent).toBe(
      'Proof · Hedera · Base · Arkiv · ENS · Recharge API',
    );
    const base = within(panel).getByRole('region', { name: 'Base' });
    expect(within(base).getByText('Settlement transaction')).toBeTruthy();
    expect(within(base).getByText('$4.00 USDC · 4000000')).toBeTruthy();
    const links = within(panel)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(links).toContain(`https://sepolia.basescan.org/tx/${TX}`);
    expect(links).toContain('https://hashscan.io/testnet/topic/0.0.6006');
    expect(links).toContain(`https://rabdi.explorer.arkiv.network/entity/${ENTITY}`);
    expect(links).toContain('https://app.ens.domains/rahul.eth');
    // every hash is copyable whole
    expect(
      within(panel).getByRole('button', { name: `Copy Settlement transaction ${TX}` }),
    ).toBeTruthy();
    const raw = screen.getByTestId('proof-raw').textContent ?? '';
    expect(raw).toContain('"name": "rahul.eth"');
    expect(raw).not.toContain(PIN);
    expect(raw).not.toContain('LPA:1$');
    expect(panel.textContent).not.toContain(PIN);

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const toggle = screen.getByRole('switch', { name: 'Show proof after each action' });
    expect((toggle as HTMLInputElement).checked).toBe(true); // on by default on a testnet
    fireEvent.click(toggle);
    expect(screen.queryByTestId('proof-panel')).toBeNull();
    expect(screen.getByText('proof links only')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByTestId('proof-panel')).toBeTruthy();
  });

  it('nothing to prove: nothing rendered but the fallback', () => {
    render(<ProofPanel proof={undefined} fallback={<p>proof links only</p>} />);
    expect(screen.queryByTestId('proof-panel')).toBeNull();
    expect(screen.getByText('proof links only')).toBeTruthy();
  });
});
