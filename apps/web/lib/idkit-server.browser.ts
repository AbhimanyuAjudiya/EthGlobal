/**
 * Browser stand-in for `@worldcoin/idkit-server` (RT-W-11, T-81, wave3-web-ops W2.2). `@worldcoin/idkit-core`'s
 * package root re-exports the RP request signer (`signRequest`, `getSessionCommitment`) from idkit-server and
 * declares no `sideEffects: false`, so a plain `import('@worldcoin/idkit-core')` shipped the signer in a client
 * chunk. next.config.ts aliases idkit-server to this file for browser targets only: the browser never carries
 * signing code, and the rp_context stays backend-signed (`POST /world/rp-context`, A-25). Server bundles still
 * resolve the real package. The `/nullifier` subpath idkit-core needs is a separate module and is not aliased.
 */
const serverOnly = (name: string) => (): never => {
  throw new Error(`${name} is server-only: the rp_context is signed by the API, never in the browser`);
};

export const signRequest = serverOnly('signRequest');
export const getSessionCommitment = serverOnly('getSessionCommitment');
export const computeRpSignatureMessage = serverOnly('computeRpSignatureMessage');
