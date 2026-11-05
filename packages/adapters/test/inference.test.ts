import { describe, expect, it } from 'vitest';

import { MockInference } from '../src/mocks/inference.js';

describe('MockInference', () => {
  it('is deterministic across fresh instances', async () => {
    const a = await new MockInference().complete('hello');
    const b = await new MockInference().complete('hello');
    expect(a).toEqual(b);
    expect(a.text).toBe('mock completion: hello');
    expect(a.model).toBe('mock-local');
    expect(a.requestId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.signature).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('gives every request its own id and binds the signature to the text', async () => {
    const inference = new MockInference();
    const first = await inference.complete('hello');
    const second = await inference.complete('hello');
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.signature).not.toBe(first.signature);
  });

  it('accepts a custom responder and model', async () => {
    const inference = new MockInference({
      respond: (prompt) => prompt.toUpperCase(),
      model: 'echo',
    });
    await expect(inference.complete('shout')).resolves.toMatchObject({
      text: 'SHOUT',
      model: 'echo',
    });
    await expect(inference.complete('x', { model: 'other' })).resolves.toMatchObject({
      model: 'other',
    });
  });
});
