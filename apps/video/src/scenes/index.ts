/**
 * Barrel for the scene components and the shared plumbing every composition mounts. The only RENDERED scenes left
 * are the end cards, titles and the judge video's explanatory panes; every product screen is a real recording
 * (human capture, else the headless capture in footage/screen/).
 */
export { EndCard, EndCardLandscape } from './EndCard';
export { ShortShell, type ShortBaseProps } from './ShortShell';
export { Title } from './Title';
export { SeedTag } from '../components/SeedTag';
export type { Shot } from '../components/ShotTrack';
export type {
  FootageAvailability,
  FootageKey,
  ScreenAvailability,
  ScreenKey,
} from '../footage/manifest';
