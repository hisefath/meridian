// Compute-unit budget per instruction (worst realistic cases), so the order book's
// O(N) matching is measured rather than assumed. Default per-instruction limit is 200k CU.
import { describe, expect, it } from 'vitest';
import { CLOSE, Harness } from './harness';

describe('compute budget', () => {
  it('every instruction stays well under 200k CU, including a taker sweeping 20 makers on a full book', async () => {
    const h = await Harness.ready();
    const cu: Record<string, number> = {};
    const measure = (name: string, meta: { computeUnitsConsumed(): bigint }) => {
      // subtract the compute-budget instruction (~150 CU)
      cu[name] = Math.max(cu[name] ?? 0, Number(meta.computeUnitsConsumed()) - 150);
    };

    const create = await h.client.createStrikeMarket(h.admin.publicKey, 5, 680_000_000, CLOSE);
    measure('create_strike_market', h.send([create], [h.admin]));
    const m = h.client.marketAddress(5, CLOSE, 680_000_000);
    const makers = Array.from({ length: 20 }, () => h.user(1_000, [m]));
    const taker = h.user(10_000, [m]);

    for (const mk of makers) measure('mint_pair', h.send([await h.client.mintPair(mk.publicKey, m, 10)], [mk]));
    // fill the book: 20 asks at distinct prices + 44 bids
    for (const [i, mk] of makers.entries()) measure('place_order (rest)', h.send([await h.client.placeOrder(mk.publicKey, m, 'ask', 60 + i, 5, 'limit')], [mk]));
    for (let i = 0; i < 44; i++) h.send([await h.client.placeOrder(taker.publicKey, m, 'bid', 1 + i, 1, 'limit')], [taker]);
    expect(h.book(m).orders.filter((o: any) => Number(o.qty) > 0)).toHaveLength(64);

    // taker sweeps all 20 asks in one order: 20 fills, each a full scan of 64 slots
    measure('place_order (sweep 20 makers)', h.send([await h.client.placeOrder(taker.publicKey, m, 'bid', 99, 100, 'ioc')], [taker]));
    measure('claim_fills', h.send([await h.client.claimFills(makers[0].publicKey, m)], [makers[0]]));
    const seq = h.book(m).orders.find((o: any) => o.owner.equals(taker.publicKey) && Number(o.qty) > 0)!.seq;
    measure('cancel_order', h.send([await h.client.cancelOrder(taker.publicKey, m, seq)], [taker]));
    measure('redeem_pair', h.send([await h.client.redeemPair(makers[1].publicKey, m, 5)], [makers[1]]));

    h.setTime(CLOSE + 1);
    measure('settle_market', h.send([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'META', priceUsd: 700, publishTime: CLOSE }))], [h.admin]));
    measure('redeem', h.send([await h.client.redeem(taker.publicKey, m)], [taker]));

    console.table(cu);
    for (const v of Object.values(cu)) expect(v).toBeLessThan(200_000);
    expect(cu['place_order (sweep 20 makers)']).toBeLessThan(150_000);
  });
});
