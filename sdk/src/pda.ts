import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';

const seed = (s: string) => Buffer.from(s);
const pda = (seeds: Buffer[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];

export const configPda = (programId = PROGRAM_ID) => pda([seed('config')], programId);

export function marketPda(ticker: number, closeTs: number | bigint, strikeMicro: number | bigint, programId = PROGRAM_ID) {
  const close = Buffer.alloc(8);
  close.writeBigInt64LE(BigInt(closeTs));
  const strike = Buffer.alloc(8);
  strike.writeBigUInt64LE(BigInt(strikeMicro));
  return pda([seed('market'), Buffer.from([ticker]), close, strike], programId);
}

/** Every account a market owns is a PDA of the market address. */
export function marketAccounts(market: PublicKey, programId = PROGRAM_ID) {
  const m = market.toBuffer();
  return {
    yesMint: pda([seed('yes'), m], programId),
    noMint: pda([seed('no'), m], programId),
    vault: pda([seed('vault'), m], programId),
    book: pda([seed('book'), m], programId),
    bookUsdc: pda([seed('book_usdc'), m], programId),
    bookYes: pda([seed('book_yes'), m], programId),
  };
}
