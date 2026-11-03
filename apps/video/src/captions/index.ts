/** Per-video caption tracks, timecoded and copied verbatim from marketing/videos/SCRIPTS.md. */
import short01 from './data/short-01-no-service.json';
import short02 from './data/short-02-scratch.json';
import short03 from './data/short-03-agent-paid.json';
import short04 from './data/short-04-gift-to-name.json';
import type { CaptionFile } from './types';

export const captionFiles = {
  Short01NoService: short01 as CaptionFile,
  Short02Scratch: short02 as CaptionFile,
  Short03AgentPaid: short03 as CaptionFile,
  Short04GiftToName: short04 as CaptionFile,
} as const;

export type CaptionedComposition = keyof typeof captionFiles;
export type { Caption, CaptionFile, CaptionStyle } from './types';
export { CaptionTrack } from './CaptionTrack';
