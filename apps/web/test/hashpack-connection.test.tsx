// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HashPackConnection } from '../components/HashPackConnection';

const device = vi.hoisted(() => ({ handheld: false }));
vi.mock('../lib/device', () => ({ isHandheld: () => device.handheld }));
afterEach(() => {
  device.handheld = false;
});
const uri = 'wc:test-pairing@2?relay-protocol=irn&symKey=test';
const link = `https://link.hashpack.app/wc?uri=${encodeURIComponent(uri)}`;
describe('native HashPack pairing', () => {
  it('desktop offers QR and exact pairing URI copy without an unsupported custom-scheme link', async () => {
    const copy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: copy },
      configurable: true,
    });
    render(<HashPackConnection state={{ uri, link }} onConnect={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy pairing link' }));
    await screen.findByRole('button', { name: 'Pairing link copied' });
    expect(copy).toHaveBeenCalledWith(uri);
    expect(screen.queryByRole('link', { name: 'Open HashPack' })).toBeNull();
  });
  it('mobile opens the native wallet with the same universal pairing link', () => {
    device.handheld = true;
    render(<HashPackConnection state={{ uri, link }} onConnect={() => undefined} />);
    expect(screen.getByRole('link', { name: 'Open HashPack' }).getAttribute('href')).toBe(link);
  });
  it('a connected account can reconnect after changing or ending its wallet session', async () => {
    const reconnect = vi.fn();
    render(
      <HashPackConnection
        state={{ session: { topic: 't', chain: 'hedera:testnet', accountId: '0.0.7001' } }}
        onConnect={reconnect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect HashPack' }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  });
});
