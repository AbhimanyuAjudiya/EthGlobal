// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScratchCard } from './ScratchCard';

const PIN = '4821993011275064';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScratchCard', () => {
  it('keeps the PIN rendered but hidden from assistive tech under the latex', () => {
    mockReducedMotion(false);
    const { container } = render(<ScratchCard mb={300} sponsor="Hedera" pin={PIN} />);
    const pin = container.querySelector('.coupon__pin');
    expect(pin?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.scratch__latex')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('falls back to a latex block when canvas is unavailable', () => {
    mockReducedMotion(false);
    const { container } = render(<ScratchCard mb={300} pin={PIN} />);
    expect(container.querySelector('.scratch__latex')?.getAttribute('data-mode')).toBe('block');
    expect(container.textContent).toContain('rub here');
    expect(container.textContent).toContain('यहाँ रगड़ें');
  });

  it('Reveal PIN is the keyboard twin: reveals, announces, calls onReveal once', () => {
    mockReducedMotion(false);
    const onReveal = vi.fn();
    const { container } = render(<ScratchCard mb={300} pin={PIN} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal PIN' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('PIN revealed');
    expect(container.querySelector('.scratch')?.getAttribute('data-via')).toBe('button');
    expect(container.querySelector('.coupon__pin')?.hasAttribute('aria-hidden')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Reveal PIN' })).toBeNull();
  });

  it('honours the revealed prop', () => {
    mockReducedMotion(false);
    const { container } = render(<ScratchCard mb={300} pin={PIN} revealed />);
    expect(container.querySelector('.scratch')?.hasAttribute('data-revealed')).toBe(true);
    expect(container.querySelector('.coupon__pin')?.textContent).toContain('4821 9930 1127 5064');
  });

  it('under reduced motion renders no canvas, only the latex block and the button', () => {
    mockReducedMotion(true);
    const { container } = render(<ScratchCard mb={300} pin={PIN} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reveal PIN' })).toBeTruthy();
  });

  it('with motion allowed it mounts a scratch canvas over the panel', () => {
    mockReducedMotion(false);
    const { container } = render(<ScratchCard mb={300} pin={PIN} />);
    expect(container.querySelector('.coupon__panel canvas.scratch__canvas')).not.toBeNull();
  });
});

it.each([false, true])(
  'can reveal again after a controlled reset (reduced motion: %s)',
  (reduced) => {
    mockReducedMotion(reduced);
    const onReveal = vi.fn();
    const view = render(<ScratchCard mb={1000} pin={PIN} revealed={false} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal PIN' }));
    view.rerender(<ScratchCard mb={1000} pin={PIN} revealed onReveal={onReveal} />);
    view.rerender(<ScratchCard mb={1000} pin={PIN} revealed={false} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal PIN' }));
    expect(onReveal).toHaveBeenCalledTimes(2);
  },
);
