import { describe, expect, it } from 'vitest';

import { isStandalone, parseDevice } from '../lib/device';

const ios = (v: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`;

describe('device', () => {
  it('iOS 17.3 has no eSIM universal link; 17.4 and later do', () => {
    expect(parseDevice(ios('17_3')).universalLink).toBe(false);
    expect(parseDevice(ios('17_4')).universalLink).toBe(true);
    expect(parseDevice(ios('18_1')).universalLink).toBe(true);
    expect(parseDevice(ios('17_4')).label).toBe('iPhone · iOS 17.4');
    expect(parseDevice(ios('18_0')).esimReady).toBe(true);
  });

  it('Android installs by code only; desktop is unknown', () => {
    const a = parseDevice(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
    );
    expect(a).toMatchObject({ os: 'android', universalLink: false, label: 'Android 14' });
    expect(a.esimReady).toBeUndefined();
    expect(parseDevice('Mozilla/5.0 (X11; Linux x86_64) Chrome/131').os).toBe('other');
  });

  it('standalone detection: display-mode media query or iOS navigator.standalone', () => {
    const mm = (matches: boolean) => () => ({ matches });
    expect(isStandalone(undefined)).toBe(false);
    expect(isStandalone({ matchMedia: mm(false), navigator: {} })).toBe(false);
    expect(isStandalone({ matchMedia: mm(true), navigator: {} })).toBe(true);
    expect(isStandalone({ matchMedia: mm(false), navigator: { standalone: true } })).toBe(true);
  });
});
