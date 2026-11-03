import { privateKeyToAccount } from 'viem/accounts';

import type { Address, Hex } from 'viem';

/** Anvil #5 (the "human" role) — public test key, the vectors' signer. */
export const HUMAN_KEY: Hex = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
export const human = privateKeyToAccount(HUMAN_KEY);
export const PAYOUT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const MOCK_USDC: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const BASE_SEPOLIA_USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
