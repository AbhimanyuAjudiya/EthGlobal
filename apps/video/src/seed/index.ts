/**
 * Seed values for the few strings the videos still draw themselves (slates, the judge end card). SCRIPTS.md §1:
 * a value on screen is a real one from the Saturday rehearsal (capture/<nn>/notes.md), never an invented one.
 * The values live in ONE file, ./saturday.json, which is what the team edits; `provenance` there decides whether
 * frames that show seeded hashes, keys or PINs carry the SEED DATA label (components/SeedTag.tsx).
 */
import saturday from './saturday.json';

/** 'local-stack': headless captures from Anvil/MODE=local (labelled). 'rehearsal': real Saturday values. */
export type Provenance = 'local-stack' | 'rehearsal';

export interface SaturdaySeed {
  provenance: Provenance;
  /** `from <sponsor>`: whatever the campaign entity says (SCRIPTS.md §1 "Honesty rules"). */
  sponsorName: string;
  short01: { push: string };
  short02: { serial: string };
  short03: { push: string };
  short04: { to: string; from: string; size: string; validUntil: string };
  judge: { endpoint: string; repo: string; disclosure: string };
}

function load(raw: typeof saturday): SaturdaySeed {
  if (raw.provenance !== 'local-stack' && raw.provenance !== 'rehearsal') {
    throw new Error(`seed/saturday.json: provenance must be local-stack or rehearsal, not ${raw.provenance}`);
  }
  return { ...raw, provenance: raw.provenance };
}

export const seed: SaturdaySeed = load(saturday);

/** True while any seeded value on screen is not yet a real Saturday record. */
export const seedLabelled = (): boolean => seed.provenance !== 'rehearsal';
