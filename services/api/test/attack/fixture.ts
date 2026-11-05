/** wave2-api-agent.md §0: the shared attack fixture is the in-process harness plus a few hostile doubles. */
import {
  MockNameResolver,
  MockPersonhood,
  type NameRecord,
  type Personhood,
} from '@ethglobal/adapters';

export * from '../support/harness.js';
export * from '../support/client.js';

/** A verifier that, unlike World's, never refuses a repeated nullifier: the API's own replay controls must hold. */
export const permissivePersonhood = (): Personhood => ({
  verify: (proof, ctx) => new MockPersonhood({ expectSignal: true }).verify(proof, ctx),
});

/** An ENS stand-in whose records can be re-pointed between purchase and claim (T-43 drift). */
export class MutableNames extends MockNameResolver {
  readonly #records = new Map<string, NameRecord>();

  set(record: NameRecord): void {
    this.#records.set(record.name, record);
  }

  override async resolve(name: string): Promise<`0x${string}` | null> {
    return this.#records.get(name)?.address ?? super.resolve(name);
  }
}
