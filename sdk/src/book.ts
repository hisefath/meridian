import type { PublicKey } from '@solana/web3.js';

/** Minimal shape of a decoded order slot (BN-like numbers accepted). */
export interface OrderSlot {
  owner: PublicKey;
  qty: { toString(): string } | number;
  claimable: { toString(): string } | number;
  seq: { toString(): string } | number;
  price: number;
  side: number; // 0 = bid, 1 = ask
}

export interface Level {
  price: number; // cents
  qty: number;
}

/** Bids best-first (high → low), asks best-first (low → high). */
export interface BookView {
  bids: Level[];
  asks: Level[];
}

const n = (v: OrderSlot['qty']) => Number(v.toString());

function aggregate(orders: OrderSlot[], side: number): Level[] {
  const byPrice = new Map<number, number>();
  for (const o of orders) {
    if (o.side === side && n(o.qty) > 0) byPrice.set(o.price, (byPrice.get(o.price) ?? 0) + n(o.qty));
  }
  return [...byPrice].map(([price, qty]) => ({ price, qty }));
}

export function yesView(orders: OrderSlot[]): BookView {
  return {
    bids: aggregate(orders, 0).sort((a, b) => b.price - a.price),
    asks: aggregate(orders, 1).sort((a, b) => a.price - b.price),
  };
}

/**
 * The same book seen from the NO side. Buying NO = selling YES into the bids,
 * so NO asks are 100 − YES bids; selling NO = buying YES from the asks.
 */
export function noView(yes: BookView): BookView {
  return {
    bids: yes.asks.map((l) => ({ price: 100 - l.price, qty: l.qty })),
    asks: yes.bids.map((l) => ({ price: 100 - l.price, qty: l.qty })),
  };
}

export const mid = (v: BookView): number | null => {
  const b = v.bids[0]?.price;
  const a = v.asks[0]?.price;
  if (b != null && a != null) return (a + b) / 2;
  return b ?? a ?? null;
};

/** Walk best-first levels for `qty`: what fills, total cost and worst price touched. */
export function walk(levels: Level[], qty: number) {
  let filled = 0;
  let costCents = 0;
  let worst: number | null = null;
  for (const l of levels) {
    if (filled >= qty) break;
    const q = Math.min(qty - filled, l.qty);
    filled += q;
    costCents += q * l.price;
    worst = l.price;
  }
  return { filled, costCents, worst, avg: filled ? costCents / filled : null };
}

export function ordersOf(orders: OrderSlot[], owner: PublicKey) {
  return orders
    .filter((o) => o.owner.equals(owner) && (n(o.qty) > 0 || n(o.claimable) > 0))
    .map((o) => ({ seq: n(o.seq), side: o.side === 0 ? ('bid' as const) : ('ask' as const), price: o.price, qty: n(o.qty), claimable: n(o.claimable) }));
}

/** Fill proceeds waiting in escrow for `owner`: YES from filled bids, USDC (base units) from filled asks. */
export function claimableOf(orders: OrderSlot[], owner: PublicKey) {
  let yes = 0;
  let usdc = 0;
  for (const o of orders) {
    if (!o.owner.equals(owner)) continue;
    if (o.side === 0) yes += n(o.claimable);
    else usdc += n(o.claimable);
  }
  return { yes, usdc };
}
