/**
 * Self-hosted faces (SCRIPTS.md §8 "Fonts"). Google Fonts is unreachable from the render sandbox, and
 * @ethglobal/ui/fonts.css starts with a Google Fonts @import, so it is never imported here.
 *
 * The woff2 files are bundled from @fontsource by webpack and registered with the FontFace API under the
 * family names the ui tokens use ('Anek Devanagari', 'Chivo Mono', 'Baloo 2'), not fontsource's
 * "… Variable" names. `fontGuard()` proves each face is actually the one that paints; it throws otherwise,
 * so a missing face fails the render instead of silently degrading it.
 */
import baloo2Deva from '@fontsource/baloo-2/files/baloo-2-devanagari-700-normal.woff2';
import baloo2Latin from '@fontsource/baloo-2/files/baloo-2-latin-700-normal.woff2';
import chivo400 from '@fontsource/chivo-mono/files/chivo-mono-latin-400-normal.woff2';
import chivo500 from '@fontsource/chivo-mono/files/chivo-mono-latin-500-normal.woff2';
import chivo700 from '@fontsource/chivo-mono/files/chivo-mono-latin-700-normal.woff2';
import anekDeva from '@fontsource-variable/anek-devanagari/files/anek-devanagari-devanagari-wdth-normal.woff2';
import anekLatin from '@fontsource-variable/anek-devanagari/files/anek-devanagari-latin-wdth-normal.woff2';

const DEVANAGARI_RANGE =
  'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+25CC, U+A830-A839, U+A8E0-A8FF';
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

interface FaceSpec {
  family: string;
  url: string;
  descriptors: FontFaceDescriptors;
}

export const FAMILIES = {
  anek: 'Anek Devanagari',
  chivo: 'Chivo Mono',
  baloo: 'Baloo 2',
} as const;

const faces: readonly FaceSpec[] = [
  {
    family: FAMILIES.anek,
    url: anekLatin,
    descriptors: { weight: '100 800', stretch: '75% 125%', unicodeRange: LATIN_RANGE },
  },
  {
    family: FAMILIES.anek,
    url: anekDeva,
    descriptors: { weight: '100 800', stretch: '75% 125%', unicodeRange: DEVANAGARI_RANGE },
  },
  // Anek's U+00B7 has no right sidebearing, so "TESTNET · test" reads "TESTNET ·test" at UI sizes. Declared last,
  // this one-codepoint face wins over the Latin face and borrows Chivo Mono's centred separator.
  {
    family: FAMILIES.anek,
    url: chivo500,
    descriptors: { weight: '100 800', stretch: '75% 125%', unicodeRange: 'U+00B7' },
  },
  { family: FAMILIES.chivo, url: chivo400, descriptors: { weight: '400' } },
  { family: FAMILIES.chivo, url: chivo500, descriptors: { weight: '500' } },
  { family: FAMILIES.chivo, url: chivo700, descriptors: { weight: '700' } },
  {
    family: FAMILIES.baloo,
    url: baloo2Latin,
    descriptors: { weight: '700', unicodeRange: LATIN_RANGE },
  },
  {
    family: FAMILIES.baloo,
    url: baloo2Deva,
    descriptors: { weight: '700', unicodeRange: DEVANAGARI_RANGE },
  },
];

/** Text each face must paint: Latin, a slashed zero, ₹ and Devanagari where the face covers it. */
const PROBES: readonly { family: string; weight: string; text: string }[] = [
  { family: FAMILIES.anek, weight: '700', text: 'Recharge 300 MB' },
  { family: FAMILIES.anek, weight: '500', text: 'क्योंकि आप इंसान हैं' },
  { family: FAMILIES.chivo, weight: '400', text: '0x1a2b 4821 9930' },
  { family: FAMILIES.baloo, weight: '700', text: 'यहाँ रगड़ें' },
];

let loading: Promise<FontGuardReport> | null = null;

export interface FontGuardReport {
  ok: boolean;
  checks: { family: string; text: string; loaded: boolean; differsFromFallback: boolean }[];
}

/**
 * Width test: a string set in "<family>, monospace" and "<family>, serif" measures the same only when the
 * named face paints every glyph (both fallbacks lose). Different widths mean a fallback face is in use.
 */
function paintsWithFace(family: string, weight: string, text: string): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const measure = (stack: string): number => {
    ctx.font = `${weight} 64px ${stack}`;
    return ctx.measureText(text).width;
  };
  const withMono = measure(`"${family}", monospace`);
  const withSerif = measure(`"${family}", serif`);
  const monoOnly = measure('monospace');
  const serifOnly = measure('serif');
  return (
    Math.abs(withMono - withSerif) < 0.01 &&
    (Math.abs(withMono - monoOnly) > 0.01 || Math.abs(withSerif - serifOnly) > 0.01)
  );
}

export function fontGuard(): FontGuardReport {
  const checks = PROBES.map(({ family, weight, text }) => {
    const ownFaces = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === family);
    const loaded = ownFaces.length > 0 && ownFaces.some((f) => f.status === 'loaded');
    return {
      family,
      text,
      loaded: loaded && document.fonts.check(`${weight} 16px "${family}"`, text),
      differsFromFallback: paintsWithFace(family, weight, text),
    };
  });
  return { ok: checks.every((c) => c.loaded && c.differsFromFallback), checks };
}

/** Registers and loads every face once per page, then runs the guard. Rejects when the guard fails. */
export function loadFonts(): Promise<FontGuardReport> {
  loading ??= (async () => {
    await Promise.all(
      faces.map(async ({ family, url, descriptors }) => {
        const face = new FontFace(family, `url(${url}) format('woff2')`, {
          display: 'block',
          ...descriptors,
        });
        document.fonts.add(face);
        await face.load();
      }),
    );
    await Promise.all(
      PROBES.map(({ family, weight, text }) =>
        document.fonts.load(`${weight} 16px "${family}"`, text),
      ),
    );
    await document.fonts.ready;
    const report = fontGuard();
    if (!report.ok) {
      throw new Error(
        `font guard: a fallback face would paint (${JSON.stringify(report.checks.filter((c) => !c.loaded || !c.differsFromFallback))})`,
      );
    }
    return report;
  })();
  return loading;
}

/** Throws unless `family` is the face that paints `text` (used by the FontProbe sabotage check). */
export function assertFacePaints(family: string, weight: string, text: string): void {
  if (!paintsWithFace(family, weight, text)) {
    throw new Error(
      `font guard: "${family}" ${weight} does not paint "${text}"; a fallback face would`,
    );
  }
}
