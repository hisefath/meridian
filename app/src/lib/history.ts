import type { ParsedEvent } from '@meridian/sdk';

/** Translate an on-chain event into a line of the user's trade log (null = not the user's). */
export function describeEvent(e: ParsedEvent, me: string): string | null {
  const d = e.data;
  const is = (k: string) => d[k]?.toBase58?.() === me;
  switch (e.name) {
    case 'fill': {
      const takerBuys = d.takerSide === 0;
      if (is('taker')) return `${takerBuys ? 'Bought' : 'Sold'} ${d.qty} YES @ ${d.price}¢ (taker)`;
      if (is('maker')) return `${takerBuys ? 'Sold' : 'Bought'} ${d.qty} YES @ ${d.price}¢ (maker fill)`;
      return null;
    }
    case 'pairsMinted':
      return is('user') ? `Minted ${d.qty} YES+NO pairs for $${d.qty}` : null;
    case 'pairsRedeemed':
      return is('user') ? `Merged ${d.qty} pairs for $${d.qty}` : null;
    case 'redeemed':
      return is('user') ? `Redeemed ${d.yesBurned} YES + ${d.noBurned} NO for $${(Number(d.payout) / 1e6).toFixed(2)}` : null;
    case 'orderPlaced':
      return is('owner') && Number(d.rested) > 0 ? `Posted ${d.side === 0 ? 'bid' : 'ask'} ${d.rested} YES @ ${d.price}¢` : null;
    case 'orderCancelled':
      return is('owner') ? `Cancelled order #${d.seq}` : null;
    case 'fillsClaimed':
      return is('owner') ? `Claimed ${d.yes} YES + $${(Number(d.usdc) / 1e6).toFixed(2)}` : null;
    default:
      return null;
  }
}
