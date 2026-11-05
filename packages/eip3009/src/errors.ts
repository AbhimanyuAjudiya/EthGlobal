/** Every failure in this package; `code` is stable and safe to branch on. */
export type Eip3009ErrorCode =
  | 'invalid_domain'
  | 'invalid_authorization'
  | 'invalid_signature'
  | 'simulation_reverted'
  | 'no_account';

export class Eip3009Error extends Error {
  override readonly name = 'Eip3009Error';

  constructor(
    readonly code: Eip3009ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
