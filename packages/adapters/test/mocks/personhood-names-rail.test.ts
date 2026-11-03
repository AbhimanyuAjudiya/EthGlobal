import { WORLD_ACTION } from '@ethglobal/protocol/ids';
import { describe, expect, it } from 'vitest';

import { MockNameResolver, MockPaymentRail, MockPersonhood } from '../../src/index.js';
import {
  describeNameResolver,
  describePaymentRail,
  describePersonhood,
  fakeClock,
  fixtureProof,
  NAME_FIXTURE,
  OTHER_SIGNAL,
  SUITE_SIGNAL,
} from '../../src/testing/index.js';

describePersonhood('MockPersonhood({ expectSignal: true })', async () => new MockPersonhood({ expectSignal: true }));
describeNameResolver('MockNameResolver', async () =>
  new MockNameResolver([{ name: NAME_FIXTURE.name, address: NAME_FIXTURE.address, text: { avatar: NAME_FIXTURE.avatar } }]),
);
describePaymentRail('MockPaymentRail', async () => ({ rail: new MockPaymentRail({ now: fakeClock().now }) }));

describe('MockPersonhood specifics', () => {
  it('rejects proof bound to another signal (O2) only with expectSignal', async () => {
    const proof = fixtureProof('orb', OTHER_SIGNAL, 'o2');
    await expect(new MockPersonhood({ expectSignal: true }).verify(proof, { action: WORLD_ACTION, signal: SUITE_SIGNAL })).rejects.toMatchObject({
      code: 'invalid_proof',
    });
    await expect(new MockPersonhood().verify(proof, { action: WORLD_ACTION, signal: SUITE_SIGNAL })).resolves.toMatchObject({ level: 'orb' });
  });

  it('a staging mock accepts staging proofs only', async () => {
    const proof = { ...fixtureProof('orb', SUITE_SIGNAL, 's'), environment: 'staging' };
    await expect(new MockPersonhood({ environment: 'staging' }).verify(proof, { action: WORLD_ACTION })).resolves.toMatchObject({
      level: 'orb',
    });
  });
});
