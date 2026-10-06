import { Keypair, PublicKey } from '@solana/web3.js';
import type { OrderSlot } from '@meridian/sdk';
import type { MarketRow } from '@/lib/meridian';

export const maker = Keypair.generate().publicKey;
export const order = (side: 0 | 1, price: number, qty: number, owner: PublicKey = maker, seq = 0): OrderSlot => ({ owner, side, price, qty, claimable: 0, seq });
/** YES book: bids 58×15, 55×3 · asks 62×7, 65×20 */
export const BOOK: OrderSlot[] = [order(0, 58, 10), order(0, 58, 5), order(0, 55, 3), order(1, 62, 7), order(1, 65, 20)];

export const market = (o: Partial<MarketRow> = {}): MarketRow => ({
  pubkey: Keypair.generate().publicKey,
  ticker: 'META',
  strikeUsd: 680,
  closeTs: Math.floor(Date.now() / 1000) + 3600,
  outcome: 'open',
  settlePriceUsd: 0,
  byOverride: false,
  collateralUsd: 0,
  ...o,
});
