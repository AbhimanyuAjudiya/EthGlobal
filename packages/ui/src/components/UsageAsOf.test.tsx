// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UsageAsOf } from './UsageAsOf';

describe('UsageAsOf', () => {
  it('renders a 24-hour en-IN clock in IST inside <time datetime>', () => {
    const at = Date.UTC(2026, 10, 8, 17, 35);
    render(<UsageAsOf at={at} />);
    const time = screen.getByText('usage as of 23:05');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe('2026-11-08T17:35:00.000Z');
  });

  it('accepts a Date and appends the zone only when the viewer is elsewhere', () => {
    const at = new Date(Date.UTC(2026, 10, 8, 8, 32));
    const { rerender } = render(<UsageAsOf at={at} viewerTimeZone="Asia/Kolkata" />);
    expect(screen.getByText('usage as of 14:02')).toBeTruthy();
    rerender(<UsageAsOf at={at} viewerTimeZone="Europe/London" />);
    expect(screen.getByText('usage as of 14:02 IST')).toBeTruthy();
  });

  it('Hindi string from §6 and the warning tone', () => {
    const { container } = render(
      <UsageAsOf at={Date.UTC(2026, 10, 8, 8, 32)} lang="hi" tone="warning" />,
    );
    expect(screen.getByText('14:02 तक का उपयोग')).toBeTruthy();
    expect(container.firstElementChild?.getAttribute('lang')).toBe('hi');
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('warning');
  });
});
