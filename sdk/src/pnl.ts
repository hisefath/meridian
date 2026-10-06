import type { PublicKey } from '@solana/web3.js';

/**
 * P&L in "YES-equivalent" terms. Holding NO is economically short YES (YES + NO = $1),
 * so one signed position covers both sides:
 *   net > 0 → long `net` YES at `avg`¢;  net < 0 → long |net| NO at (100 − avg)¢.
 * Minting or merging a pair is flat (+1 YES +1 NO = $1) and doesn't move the position,
 * so "Buy NO" (mint + sell YES @p) shows as NO bought at 100 − p.
 */
export interface Position {
  net: number;
  avg: number; // cents, YES terms
  realized: number; // cents
}

export type LedgerEvent =
  | { kind: 'trade'; side: 'buy' | 'sell'; price: number; qty: number } // YES traded at price¢
  | { kind: 'settle'; yesWon: boolean };

export const flat = (): Position => ({ net: 0, avg: 0, realized: 0 });

function trade(p: Position, side: 'buy' | 'sell', price: number, qty: number): Position {
  const dir = side === 'buy' ? 1 : -1;
  let { net, avg, realized } = p;
  let q = qty;
  // closing part: trade against the existing position
  if (net !== 0 && Math.sign(net) !== dir) {
    const close = Math.min(q, Math.abs(net));
    realized += Math.sign(net) * (price - avg) * close;
    net += dir * close;
    q -= close;
    if (net === 0) avg = 0;
  }
  // opening part: extend (or flip into) the position at volume-weighted average
  if (q > 0) {
    const size = Math.abs(net);
    avg = (avg * size + price * q) / (size + q);
    net += dir * q;
  }
  return { net, avg, realized };
}

export function applyEvents(events: LedgerEvent[], start: Position = flat()): Position {
  return events.reduce((p, e) => {
    if (e.kind === 'trade') return trade(p, e.side, e.price, e.qty);
    // settlement closes everything at 100¢ or 0¢
    return p.net === 0 ? p : trade(p, p.net > 0 ? 'sell' : 'buy', e.yesWon ? 100 : 0, Math.abs(p.net));
  }, start);
}

/** Mark-to-market P&L in cents at a YES mark price. */
export const unrealized = (p: Position, markYes: number) => p.net * (markYes - p.avg);

/** Human view of a position: which token, how many, entry and mark in that token's cents. */
export function describe(p: Position, markYes: number | null) {
  if (p.net === 0) return null;
  const side = p.net > 0 ? ('YES' as const) : ('NO' as const);
  const entry = side === 'YES' ? p.avg : 100 - p.avg;
  const mark = markYes == null ? null : side === 'YES' ? markYes : 100 - markYes;
  return { side, qty: Math.abs(p.net), entry, mark, unrealized: markYes == null ? null : unrealized(p, markYes) };
}

/** Fill events (as emitted on-chain) → ledger trades for one user. */
export function fillsToTrades(
  fills: { maker: PublicKey; taker: PublicKey; takerSide: number; price: number; qty: number }[],
  user: PublicKey,
): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const f of fills) {
    const takerBuys = f.takerSide === 0;
    if (f.taker.equals(user)) out.push({ kind: 'trade', side: takerBuys ? 'buy' : 'sell', price: f.price, qty: f.qty });
    if (f.maker.equals(user)) out.push({ kind: 'trade', side: takerBuys ? 'sell' : 'buy', price: f.price, qty: f.qty });
  }
  return out;
}
