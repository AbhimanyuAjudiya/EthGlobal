/**
 * calculateMetadata that probes footage/ and hands the result to the composition: `footage` (the human team's
 * captures) and `screens` (the headless captures of the PWA in the composition's theme).
 */
import { type CalculateMetadataFunction } from 'remotion';

import {
  type FootageAvailability,
  type FootageKey,
  type ScreenAvailability,
  type ScreenKey,
  type ScreenTheme,
} from '../footage/manifest';
import { probeFootage, probeScreens } from '../footage/probe';

export function withFootage<
  P extends { footage: FootageAvailability; screens: ScreenAvailability; theme: ScreenTheme },
>(keys: readonly FootageKey[], screens: readonly ScreenKey[]): CalculateMetadataFunction<P> {
  return async ({ props }) => {
    const fetchImpl = globalThis.fetch.bind(globalThis);
    return {
      props: {
        ...props,
        footage: await probeFootage(keys, fetchImpl),
        screens: await probeScreens(screens, props.theme, fetchImpl),
      },
    };
  };
}
