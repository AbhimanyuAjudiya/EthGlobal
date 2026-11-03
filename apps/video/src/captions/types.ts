/** Caption track schema (SCRIPTS.md §8 "Captions"), shared by the renderer, the lint and the tests. */
export type CaptionStyle = 'hook' | 'footage' | 'ui' | 'note';

export interface Caption {
  /** First frame shown (inclusive), composition time. */
  from: number;
  /** Frame after the last one shown (exclusive). */
  to: number;
  /** Verbatim on-screen string from SCRIPTS.md. */
  text: string;
  style: CaptionStyle;
  lang: 'en' | 'hi';
  /** Substrings of `text` set in Chivo Mono (amounts, times, hashes). */
  mono?: string[];
  /** Shown only when the composition flag is true (`flag`) or false (`!flag`). */
  when?: string;
}

export interface CaptionFile {
  composition: string;
  source: string;
  durationInFrames: number;
  captions: Caption[];
}
