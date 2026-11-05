/** describeNameResolver: the ENS-shaped port contract (L11, T-43). Subjects resolve alice.eth → anvil #0 with an avatar. */
import { describe, expect, it } from 'vitest';

import { anvilAccounts } from '../anvil.js';

import type { NameResolver } from '../../types.js';

export const NAME_FIXTURE = {
  name: 'alice.eth',
  address: anvilAccounts[0],
  avatar: 'https://example.test/alice.png',
} as const;

export function describeNameResolver(name: string, make: () => Promise<NameResolver>): void {
  describe(`NameResolver contract: ${name}`, () => {
    it('normalises before resolving: "  Alice.ETH " ⇒ alice.eth', async () => {
      const names = await make();
      await expect(names.resolve('  Alice.ETH ')).resolves.toBe(NAME_FIXTURE.address);
      await expect(names.resolve(NAME_FIXTURE.name)).resolves.toBe(NAME_FIXTURE.address);
    });

    it('an unresolvable name is null', async () => {
      const names = await make();
      await expect(names.resolve('nobody.eth')).resolves.toBeNull();
      await expect(names.getText('nobody.eth', 'avatar')).resolves.toBeNull();
    });

    it('text records', async () => {
      const names = await make();
      await expect(names.getText('Alice.eth', 'avatar')).resolves.toBe(NAME_FIXTURE.avatar);
    });

    it.each([
      ['Cyrillic а homoglyph', 'rаhul.eth'],
      ['zero-width space', 'alice​.eth'],
      ['empty label', 'alice..eth'],
      ['no dot', 'alice'],
      ['empty', '   '],
    ])('%s ⇒ invalid_name (never a lookup)', async (_case, input) => {
      const names = await make();
      await expect(names.resolve(input)).rejects.toMatchObject({ code: 'invalid_name' });
      await expect(names.getText(input, 'avatar')).rejects.toMatchObject({ code: 'invalid_name' });
    });
  });
}
