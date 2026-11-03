/** calculateMetadata that probes footage/ and hands the result to the composition as `footage`. */
import { type CalculateMetadataFunction } from 'remotion';

import { type FootageAvailability, type FootageKey } from '../footage/manifest';
import { probeFootage } from '../footage/probe';

export function withFootage<P extends { footage: FootageAvailability }>(
  keys: readonly FootageKey[],
): CalculateMetadataFunction<P> {
  return async ({ props }) => ({
    props: { ...props, footage: await probeFootage(keys, globalThis.fetch.bind(globalThis)) },
  });
}
