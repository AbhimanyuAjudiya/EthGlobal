/** EIP-712 verification for the four Recharge messages (protocol/typed-data); a malformed signature is just "no". */
import { verifyTypedData, type TypedData, type VerifyTypedDataParameters } from 'viem';

export async function signedBy<
  const T extends TypedData | Record<string, unknown>,
  P extends keyof T | 'EIP712Domain',
>(args: VerifyTypedDataParameters<T, P>): Promise<boolean> {
  try {
    return await verifyTypedData(args);
  } catch {
    return false;
  }
}
