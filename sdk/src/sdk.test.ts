import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { applyEvents, checkIntent, computeStrikes, describe as describePos, fillsToTrades, noView, walk, yesPrice, yesView } from './index';

const usd = (n: number) => BigInt(n) * 1_000_000n;

describe('strike selection (brief examples)', () => {
  it('META 680 → 620…740', () => {
    expect(computeStrikes(usd(680)).map((s) => Number(s / 1_000_000n))).toEqual([620, 640, 660, 680, 700, 720, 740]);
  });
  it('AAPL 230 → deduplicated to 5 strikes', () => {
    expect(computeStrikes(usd(230)).map((s) => Number(s / 1_000_000n))).toEqual([210, 220, 230, 240, 250]);
  });
  it('rounds half up with integer math and drops non-positive strikes', () => {
    expect(computeStrikes(usd(235), [], true)).toEqual([usd(240)]);
    expect(computeStrikes(usd(5), [3], true)).toEqual([usd(10)]); // 4.85 → $0 is dropped
  });
});

describe('one book, two views', () => {
  const k = Keypair.generate().publicKey;
  const o = (side: number, price: number, qty: number) => ({ owner: k, side, price, qty, claimable: 0, seq: 0 });
  const book = yesView([o(0, 58, 10), o(0, 58, 5), o(0, 55, 3), o(1, 62, 7), o(1, 65, 2)]);

  it('aggregates YES levels best-first', () => {
    expect(book.bids).toEqual([{ price: 58, qty: 15 }, { price: 55, qty: 3 }]);
    expect(book.asks).toEqual([{ price: 62, qty: 7 }, { price: 65, qty: 2 }]);
  });
  it('NO view mirrors prices: NO ask = 100 − YES bid', () => {
    const no = noView(book);
    expect(no.asks[0]).toEqual({ price: 42, qty: 15 });
    expect(no.bids[0]).toEqual({ price: 38, qty: 7 });
  });
  it('walks levels for a market order', () => {
    expect(walk(book.asks, 8)).toEqual({ filled: 8, costCents: 7 * 62 + 65, worst: 65, avg: (7 * 62 + 65) / 8 });
  });
});

describe('position constraint', () => {
  it('blocks buying the opposite side', () => {
    expect(checkIntent({ action: 'buyYes', qty: 1, price: 50, kind: 'limit' }, { yes: 0, no: 3 }).ok).toBe(false);
    expect(checkIntent({ action: 'buyNo', qty: 1, price: 50, kind: 'limit' }, { yes: 2, no: 0 }).ok).toBe(false);
    expect(checkIntent({ action: 'buyYes', qty: 1, price: 50, kind: 'limit' }, { yes: 5, no: 0 }).ok).toBe(true);
    expect(checkIntent({ action: 'sellNo', qty: 4, price: 50, kind: 'limit' }, { yes: 0, no: 3 }).ok).toBe(false);
  });
  it('maps NO prices onto the YES book', () => {
    expect(yesPrice({ action: 'buyNo', qty: 1, price: 42, kind: 'market' })).toBe(58);
    expect(yesPrice({ action: 'buyYes', qty: 1, price: 42, kind: 'market' })).toBe(42);
  });
});

describe('P&L ledger', () => {
  it('long YES: average cost, partial close, settlement', () => {
    const p = applyEvents([
      { kind: 'trade', side: 'buy', price: 60, qty: 10 },
      { kind: 'trade', side: 'buy', price: 70, qty: 10 },
      { kind: 'trade', side: 'sell', price: 80, qty: 5 },
    ]);
    expect(p).toEqual({ net: 15, avg: 65, realized: 75 });
    const settled = applyEvents([{ kind: 'settle', yesWon: true }], p);
    expect(settled).toEqual({ net: 0, avg: 0, realized: 75 + 15 * 35 });
  });

  it('Buy NO (mint + sell YES @58) is NO at 42¢; NO winning pays 58¢ each', () => {
    const p = applyEvents([{ kind: 'trade', side: 'sell', price: 58, qty: 10 }]);
    expect(describePos(p, 50)).toEqual({ side: 'NO', qty: 10, entry: 42, mark: 50, unrealized: 80 });
    expect(applyEvents([{ kind: 'settle', yesWon: false }], p).realized).toBe(580);
  });

  it('attributes maker and taker sides from fill events', () => {
    const me = Keypair.generate().publicKey;
    const other = Keypair.generate().publicKey;
    const t = fillsToTrades(
      [
        { maker: other, taker: me, takerSide: 0, price: 60, qty: 2 },
        { maker: me, taker: other, takerSide: 0, price: 61, qty: 3 },
      ],
      me,
    );
    expect(t).toEqual([
      { kind: 'trade', side: 'buy', price: 60, qty: 2 },
      { kind: 'trade', side: 'sell', price: 61, qty: 3 },
    ]);
  });
});
