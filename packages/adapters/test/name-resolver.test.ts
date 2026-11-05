import { describe, expect, it } from 'vitest';

import { MockNameResolver, anvilAccounts } from '../src/mocks/name-resolver.js';

describe('MockNameResolver', () => {
  it('resolves the default fixtures case-insensitively', async () => {
    const names = new MockNameResolver();
    await expect(names.resolve('alice.eth')).resolves.toBe(anvilAccounts[0]);
    await expect(names.resolve('  Bob.ETH ')).resolves.toBe(anvilAccounts[1]);
    await expect(names.resolve('nobody.eth')).resolves.toBeNull();
  });

  it('serves text records from injected fixtures', async () => {
    const names = new MockNameResolver([
      { name: 'carol.eth', address: anvilAccounts[2], text: { url: 'https://example.com' } },
    ]);
    await expect(names.getText('carol.eth', 'url')).resolves.toBe('https://example.com');
    await expect(names.getText('carol.eth', 'avatar')).resolves.toBeNull();
    await expect(names.getText('alice.eth', 'url')).resolves.toBeNull();
  });
});
