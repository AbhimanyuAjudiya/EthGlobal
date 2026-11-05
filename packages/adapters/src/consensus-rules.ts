/** Shared by MockConsensusLog and HcsLog: topic id form and the one-chunk limit (T-44). */
import { HCS_MAX_BYTES } from '@ethglobal/protocol/schemas';

import { AdapterError } from './errors.js';

const TOPIC = /^0\.0\.\d{1,12}$/;

export function assertTopicMessage(topic: string, message: string): void {
  if (!TOPIC.test(topic))
    throw new AdapterError('consensus', 'invalid_request', 'topic must be 0.0.x');
  const bytes = new TextEncoder().encode(message).length;
  if (bytes === 0) throw new AdapterError('consensus', 'invalid_request', 'empty message');
  if (bytes > HCS_MAX_BYTES) {
    throw new AdapterError(
      'consensus',
      'too_large',
      `message is ${bytes} bytes (max ${HCS_MAX_BYTES})`,
      {
        bytes,
      },
    );
  }
}

export function assertTopic(topic: string): void {
  if (!TOPIC.test(topic))
    throw new AdapterError('consensus', 'invalid_request', 'topic must be 0.0.x');
}
