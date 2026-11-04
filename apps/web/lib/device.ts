/**
 * UA-based pre-flight (design-references §1a, the Airalo borrow): "can this phone use eSIMs" before money,
 * and Home Screen (standalone) detection for Web Push (iOS 16.4+ needs it).
 */
export type DeviceOs = 'ios' | 'android' | 'other';

export interface DeviceInfo {
  os: DeviceOs;
  /** [major, minor] when the UA says it. */
  version?: [number, number];
  /** iOS 17.4+ opens the eSIM universal link; Android installs by code; other: unknown. */
  universalLink: boolean;
  /** true / false when the UA allows a claim, undefined when a browser cannot tell. */
  esimReady?: boolean;
  label: string;
}

const IOS = /(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/;
const ANDROID = /Android (\d+)(?:\.(\d+))?/;

export function parseDevice(ua: string): DeviceInfo {
  const ios = IOS.exec(ua);
  if (ios) {
    const version: [number, number] = [Number(ios[1]), Number(ios[2])];
    const universalLink = version[0] > 17 || (version[0] === 17 && version[1] >= 4);
    return {
      os: 'ios',
      version,
      universalLink,
      // eSIM since iPhone XS / iOS 12; every iOS 17 device is an XS or later
      esimReady: version[0] >= 12,
      label: `iPhone · iOS ${version[0]}${version[1] ? `.${version[1]}` : ''}`,
    };
  }
  const android = ANDROID.exec(ua);
  if (android) {
    const version: [number, number] = [Number(android[1]), Number(android[2] ?? 0)];
    return { os: 'android', version, universalLink: false, label: `Android ${version[0]}` };
  }
  return { os: 'other', universalLink: false, label: 'This browser' };
}

/** The pre-flight line under the first button. */
export function preflightLine(device: DeviceInfo): { key: 'preflight.ready' | 'preflight.unknown'; label: string } {
  return device.esimReady
    ? { key: 'preflight.ready', label: device.label }
    : { key: 'preflight.unknown', label: device.label };
}

/** Home Screen app: `display-mode: standalone` or iOS's navigator.standalone. */
export function isStandalone(
  win: { matchMedia?: (q: string) => { matches: boolean }; navigator?: unknown } | undefined,
): boolean {
  if (!win) return false;
  if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (win.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}
