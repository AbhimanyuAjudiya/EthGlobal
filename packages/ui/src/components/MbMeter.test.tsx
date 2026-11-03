// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MbMeter } from './MbMeter';

const NOW = Date.UTC(2026, 10, 8, 8, 32);

describe('MbMeter', () => {
  it('is a labelled meter with values and a text twin in tabular figures', () => {
    const { container } = render(<MbMeter remainingMb={212} totalMb={300} usageAsOf={NOW} />);
    const meter = screen.getByRole('meter', { name: 'Data left' });
    expect(meter.getAttribute('aria-valuenow')).toBe('212');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('300');
    expect(meter.getAttribute('aria-valuetext')).toBe('212\u00a0MB left of 300\u00a0MB');
    expect(container.querySelector('.mb-meter__left')?.textContent).toBe('212\u00a0MB left');
    expect(screen.getByText('usage as of 14:02')).toBeTruthy();
  });

  it('warns at ≥ 80 % used and not before; the usage line follows', () => {
    const { container, rerender } = render(
      <MbMeter remainingMb={61} totalMb={300} usageAsOf={NOW} />,
    );
    expect(container.querySelector('.mb-meter')?.hasAttribute('data-warning')).toBe(false);
    rerender(<MbMeter remainingMb={60} totalMb={300} usageAsOf={NOW} />);
    expect(container.querySelector('.mb-meter')?.hasAttribute('data-warning')).toBe(true);
    expect(container.querySelector('.usage-as-of')?.getAttribute('data-tone')).toBe('warning');
  });

  it('snaps on data ticks: the fill is a transform with no animation unless fillOnce', () => {
    const { container, rerender } = render(<MbMeter remainingMb={150} totalMb={300} />);
    const fill = container.querySelector<HTMLElement>('.mb-meter__fill');
    expect(fill?.style.transform).toBe('scaleX(0.5)');
    expect(fill?.className).toBe('mb-meter__fill');
    rerender(<MbMeter remainingMb={75} totalMb={300} />);
    expect(container.querySelector<HTMLElement>('.mb-meter__fill')?.style.transform).toBe(
      'scaleX(0.25)',
    );
    rerender(<MbMeter remainingMb={300} totalMb={300} fillOnce />);
    expect(container.querySelector('.mb-meter__fill--once')).not.toBeNull();
  });

  it('clamps out-of-range values and labels simulated usage', () => {
    render(<MbMeter remainingMb={500} totalMb={300} source="simulated usage" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('300');
    expect(screen.getByText(/simulated usage/)).toBeTruthy();
  });
});
