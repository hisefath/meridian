import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { MeridianClient } from './client';

export type Action = 'buyYes' | 'sellYes' | 'buyNo' | 'sellNo';

export interface TradeIntent {
  action: Action;
  qty: number;
  /**
   * Price in the token the user is trading, in cents: YES price for *Yes actions,
   * NO price for *No actions. For market orders this is the worst acceptable price.
   */
  price: number;
  kind: 'market' | 'limit';
}

export interface Holdings {
  yes: number;
  no: number;
}

/**
 * Position constraint from the brief: from the trading UI a user holds YES or NO
 * for a strike, never both. Exiting the other side first is required.
 */
export function checkIntent(intent: TradeIntent, h: Holdings): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(intent.qty) || intent.qty <= 0) return { ok: false, reason: 'Quantity must be a whole number of contracts' };
  if (!Number.isInteger(intent.price) || intent.price < 1 || intent.price > 99)
    return { ok: false, reason: 'Price must be between 1¢ and 99¢' };
  switch (intent.action) {
    case 'buyYes':
      return h.no > 0 ? { ok: false, reason: `You hold ${h.no} NO. Sell your NO position before buying YES.` } : { ok: true };
    case 'buyNo':
      return h.yes > 0 ? { ok: false, reason: `You hold ${h.yes} YES. Sell your YES position before buying NO.` } : { ok: true };
    case 'sellYes':
      return h.yes >= intent.qty ? { ok: true } : { ok: false, reason: `You only hold ${h.yes} YES` };
    case 'sellNo':
      return h.no >= intent.qty ? { ok: true } : { ok: false, reason: `You only hold ${h.no} NO` };
  }
}

/** YES-book price for an intent (NO prices are mirrored: 100 − p). */
export const yesPrice = (i: TradeIntent) => (i.action === 'buyNo' || i.action === 'sellNo' ? 100 - i.price : i.price);

/**
 * Translate a user intent into instructions for ONE transaction (one signature, atomic).
 *  Buy YES  → bid YES
 *  Sell YES → ask YES
 *  Buy NO   → mint pair, ask YES          (user keeps NO; cost = $1 − YES proceeds)
 *  Sell NO  → bid YES, merge YES+NO → $1  (market); the merge happens on claim for limits
 * Market orders are fill-or-kill so Buy NO can never leave a stray YES behind.
 */
export async function intentInstructions(
  client: MeridianClient,
  user: PublicKey,
  market: PublicKey,
  intent: TradeIntent,
): Promise<TransactionInstruction[]> {
  const kind = intent.kind === 'market' ? 'fok' : 'limit';
  const p = yesPrice(intent);
  const ixs = client.ensureTokenAccounts(user, user, market);
  switch (intent.action) {
    case 'buyYes':
      ixs.push(await client.placeOrder(user, market, 'bid', p, intent.qty, kind));
      break;
    case 'sellYes':
      ixs.push(await client.placeOrder(user, market, 'ask', p, intent.qty, kind));
      break;
    case 'buyNo':
      ixs.push(await client.mintPair(user, market, intent.qty));
      ixs.push(await client.placeOrder(user, market, 'ask', p, intent.qty, kind));
      break;
    case 'sellNo':
      ixs.push(await client.placeOrder(user, market, 'bid', p, intent.qty, kind));
      if (kind === 'fok') ixs.push(await client.redeemPair(user, market, intent.qty));
      break;
  }
  return ixs;
}

/** Payoff copy for the trade panel. */
export function payoffText(intent: TradeIntent, ticker: string, strikeUsd: number) {
  const pay = ((intent.price * intent.qty) / 100).toFixed(2);
  const win = intent.qty.toFixed(2);
  const yesSide = intent.action === 'buyYes' || intent.action === 'sellNo';
  const cond = yesSide ? `closes at or above $${strikeUsd}` : `closes below $${strikeUsd}`;
  if (intent.action === 'buyYes' || intent.action === 'buyNo') return `You pay $${pay}. You win $${win} if ${ticker} ${cond}.`;
  return `You receive about $${pay} now and give up the $${win} payout if ${ticker} ${yesSide ? `closes below $${strikeUsd}` : `closes at or above $${strikeUsd}`}.`;
}
