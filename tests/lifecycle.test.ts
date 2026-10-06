// Integration: full lifecycle, the four trade paths through the SDK's intent layer,
// and a multi-user market-maker / taker scenario.
import { describe, expect, it } from 'vitest';
import type { Keypair, PublicKey } from '@solana/web3.js';
import { intentInstructions, type TradeIntent } from '../sdk/src';
import { CLOSE, Harness, USD } from './harness';

async function trade(h: Harness, user: Keypair, m: PublicKey, intent: TradeIntent) {
  return h.send(await intentInstructions(h.client, user.publicKey, m, intent), [user]);
}

describe('four trade paths on one book', () => {
  async function setup() {
    const h = await Harness.ready();
    const m = await h.market('META', 680);
    const mm = h.user(10_000, [m]);
    const user = h.user(1_000, [m]);
    // market maker quotes both sides of YES: bid 58 / ask 62
    h.send([await h.client.mintPair(mm.publicKey, m, 500)], [mm]);
    h.send([await h.client.placeOrder(mm.publicKey, m, 'ask', 62, 200, 'limit')], [mm]);
    h.send([await h.client.placeOrder(mm.publicKey, m, 'bid', 58, 200, 'limit')], [mm]);
    return { h, m, mm, user };
  }

  it('Buy YES then Sell YES', async () => {
    const { h, m, user } = await setup();
    await trade(h, user, m, { action: 'buyYes', qty: 10, price: 65, kind: 'market' });
    expect(h.yes(user.publicKey, m)).toBe(10);
    expect(h.usdc(user.publicKey)).toBe((1_000 - 6.2) * USD);

    await trade(h, user, m, { action: 'sellYes', qty: 10, price: 55, kind: 'market' });
    expect(h.yes(user.publicKey, m)).toBe(0);
    expect(h.usdc(user.publicKey)).toBe(1_000 * USD - 6_200_000 + 5_800_000); // round trip costs the 4¢ spread
  });

  it('Buy NO = mint pair + sell YES at the bid, atomically, one signature', async () => {
    const { h, m, user } = await setup();
    // NO ask = 100 − best YES bid (58) = 42¢
    await trade(h, user, m, { action: 'buyNo', qty: 10, price: 45, kind: 'market' });
    expect(h.no(user.publicKey, m)).toBe(10);
    expect(h.yes(user.publicKey, m)).toBe(0); // the YES leg was sold
    expect(h.usdc(user.publicKey)).toBe((1_000 - 4.2) * USD); // paid $10, got $5.80 back
  });

  it('Buy NO market order reverts entirely if the YES leg cannot fill (no stray pairs)', async () => {
    const { h, m, user } = await setup();
    h.fails(await intentInstructions(h.client, user.publicKey, m, { action: 'buyNo', qty: 300, price: 45, kind: 'market' }), [user], 'FillOrKillNotFilled');
    expect([h.yes(user.publicKey, m), h.no(user.publicKey, m), h.usdc(user.publicKey)]).toEqual([0, 0, 1_000 * USD]);
  });

  it('Sell NO = buy YES at the ask + merge YES+NO for $1, atomically', async () => {
    const { h, m, user } = await setup();
    await trade(h, user, m, { action: 'buyNo', qty: 10, price: 45, kind: 'market' });
    // NO bid = 100 − best YES ask (62) = 38¢
    await trade(h, user, m, { action: 'sellNo', qty: 10, price: 35, kind: 'market' });
    expect([h.yes(user.publicKey, m), h.no(user.publicKey, m)]).toEqual([0, 0]);
    expect(h.usdc(user.publicKey)).toBe(1_000 * USD - 4_200_000 + 3_800_000);
  });

  it('Buy NO limit rests a YES ask; the user holds both until it fills', async () => {
    const { h, m, user } = await setup();
    await trade(h, user, m, { action: 'buyNo', qty: 5, price: 40, kind: 'limit' }); // ask YES @ 60
    expect(h.no(user.publicKey, m)).toBe(5);
    expect(h.yes(user.publicKey, m)).toBe(0); // YES is escrowed in the book
    const mine = h.book(m).orders.filter((o: any) => o.owner.equals(user.publicKey));
    expect(mine.map((o: any) => [o.price, Number(o.qty)])).toEqual([[60, 5]]);
  });
});

describe('full lifecycle: create → mint → trade → settle → redeem (multi-user)', () => {
  it('conserves USDC across all participants and drains the vault to zero', async () => {
    const h = await Harness.ready();
    const m = await h.market('AAPL', 230);
    const mm = h.user(1_000, [m]);
    const bull = h.user(1_000, [m]);
    const bear = h.user(1_000, [m]);
    const total = () => [mm, bull, bear].reduce((s, u) => s + h.usdc(u.publicKey), 0) + h.tokenAmount(h.client.accounts(m).vault) + h.tokenAmount(h.client.accounts(m).bookUsdc);
    const start = total();

    // market maker mints and quotes
    h.send([await h.client.mintPair(mm.publicKey, m, 100)], [mm]);
    h.send([await h.client.placeOrder(mm.publicKey, m, 'ask', 55, 60, 'limit')], [mm]);
    h.send([await h.client.placeOrder(mm.publicKey, m, 'bid', 50, 60, 'limit')], [mm]);

    // takers: bull buys YES, bear buys NO
    await trade(h, bull, m, { action: 'buyYes', qty: 40, price: 55, kind: 'market' });
    await trade(h, bear, m, { action: 'buyNo', qty: 30, price: 50, kind: 'market' });
    expect(total()).toBe(start);

    // close: trading halts on-chain
    h.setTime(CLOSE);
    h.fails([await h.client.placeOrder(bull.publicKey, m, 'bid', 60, 1, 'ioc')], [bull], 'MarketClosed');

    // settle via oracle: AAPL closes at 231.20 ≥ 230 → YES
    h.setTime(CLOSE + 4);
    h.send([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'AAPL', priceUsd: 231.2, publishTime: CLOSE }))], [h.admin]);

    // makers pull fills and resting escrow, then everybody redeems
    h.send([await h.client.claimFills(mm.publicKey, m)], [mm]);
    for (const o of h.book(m).orders.filter((o: any) => o.owner.equals(mm.publicKey) && Number(o.qty) > 0)) {
      h.send([await h.client.cancelOrder(mm.publicKey, m, o.seq)], [mm]);
    }
    for (const u of [mm, bull, bear]) {
      if (h.yes(u.publicKey, m) + h.no(u.publicKey, m) > 0) h.send([await h.client.redeem(u.publicKey, m)], [u]);
    }

    expect(h.collateralSnapshot(m)).toEqual({ vault: 0, collateral: 0, yesSupply: 0, noSupply: 0 });
    expect(h.tokenAmount(h.client.accounts(m).bookUsdc)).toBe(0);
    expect(total()).toBe(start);
    // bull paid 40 × 55¢ = $22 and won $40; bear paid 30 × (100−50)¢ = $15 and lost it
    expect(h.usdc(bull.publicKey)).toBe((1_000 - 22 + 40) * USD);
    expect(h.usdc(bear.publicKey)).toBe((1_000 - 15) * USD);
    expect(h.usdc(mm.publicKey)).toBe((1_000 + 15 - 18) * USD); // zero-sum
  });
});
