// Per-instruction unit tests against the compiled program (LiteSVM).
import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { intentInstructions } from '../sdk/src';
import { CLOSE, Harness, OPEN, USD } from './harness';

describe('initialize_config / admin', () => {
  it('stores config and can only be initialised once', async () => {
    const h = await Harness.ready();
    const cfg = h.client.program.coder.accounts.decode('config', Buffer.from(h.svm.getAccount(h.client.config)!.data));
    expect(cfg.admin.equals(h.admin.publicKey)).toBe(true);
    expect(cfg.maxConfBps).toBe(200);
    expect(Buffer.from(cfg.tickers[5]).toString().replace(/\0+$/, '')).toBe('META');
    await expect(async () =>
      h.send([await h.client.initializeConfig(h.admin.publicKey, { maxStalenessSecs: 1, maxConfBps: 1, overrideDelaySecs: 60 })], [h.admin]),
    ).rejects.toThrow();
  });

  it('rejects an override delay below 60s', async () => {
    const h = new Harness();
    h.fails([await h.client.initializeConfig(h.admin.publicKey, { maxStalenessSecs: 300, maxConfBps: 200, overrideDelaySecs: 59 })], [h.admin], 'InvalidConfig');
  });

  it('only the admin can pause; admin handover is two-step (propose, then accept)', async () => {
    const h = await Harness.ready();
    const eve = h.user();
    h.fails([await h.client.setPaused(eve.publicKey, true)], [eve], 'Unauthorized');
    const next = h.user();
    h.send([await h.client.setAdmin(h.admin.publicKey, next.publicKey)], [h.admin]);
    h.send([await h.client.setPaused(h.admin.publicKey, true)], [h.admin]); // old admin still in charge
    h.fails([await h.client.acceptAdmin(eve.publicKey)], [eve], 'Unauthorized'); // only the proposed key can accept
    h.send([await h.client.acceptAdmin(next.publicKey)], [next]);
    h.fails([await h.client.setPaused(h.admin.publicKey, false)], [h.admin], 'Unauthorized');
    h.send([await h.client.setPaused(next.publicKey, false)], [next]);
  });

  it('rejects an override delay that does not exceed the oracle window', async () => {
    const h = new Harness();
    h.fails([await h.client.initializeConfig(h.admin.publicKey, { maxStalenessSecs: 300, maxConfBps: 200, overrideDelaySecs: 300 })], [h.admin], 'InvalidConfig');
  });
});

describe('create_strike_market / add_strike', () => {
  it('creates market, mints, vault, book and escrows owned by the market PDA', async () => {
    const h = await Harness.ready();
    const m = await h.market('META', 680);
    const s = h.marketState(m);
    expect(Number(s.strike)).toBe(680 * USD);
    expect(Number(s.closeTs)).toBe(CLOSE);
    expect('open' in s.outcome).toBe(true);
    for (const k of Object.values(h.client.accounts(m))) expect(h.svm.getAccount(k)).not.toBeNull();
    expect(h.book(m).market.equals(m)).toBe(true);
  });

  it('rejects non-admin, past close, bad ticker, zero strike and duplicates', async () => {
    const h = await Harness.ready();
    const eve = h.user();
    h.fails([await h.client.createStrikeMarket(eve.publicKey, 0, 230 * USD, CLOSE)], [eve], 'Unauthorized');
    h.fails([await h.client.createStrikeMarket(h.admin.publicKey, 0, 230 * USD, OPEN - 1)], [h.admin], 'CloseInPast');
    h.fails([await h.client.createStrikeMarket(h.admin.publicKey, 7, 230 * USD, CLOSE)], [h.admin], 'InvalidTicker');
    h.fails([await h.client.createStrikeMarket(h.admin.publicKey, 0, 0, CLOSE)], [h.admin], 'InvalidStrike');
    await h.market('AAPL', 230);
    await expect(h.market('AAPL', 230)).rejects.toThrow(/already in use/);
  });

  it('add_strike creates an intraday market and emits intraday=true', async () => {
    const h = await Harness.ready();
    const meta = h.send([await h.client.createStrikeMarket(h.admin.publicKey, 6, 405 * USD, CLOSE, true)], [h.admin]);
    const ev = h.events(meta).find((e) => e.name === 'marketCreated')!;
    expect(ev.data.intraday).toBe(true);
  });
});

describe('mint_pair / redeem_pair', () => {
  it('mints 1 YES + 1 NO per $1 and keeps vault == collateral == supply × $1', async () => {
    const h = await Harness.ready();
    const m = await h.market('NVDA', 190);
    const u = h.user(100, [m]);
    h.send([await h.client.mintPair(u.publicKey, m, 40)], [u]);
    expect(h.usdc(u.publicKey)).toBe(60 * USD);
    expect([h.yes(u.publicKey, m), h.no(u.publicKey, m)]).toEqual([40, 40]);
    expect(h.collateralSnapshot(m)).toEqual({ vault: 40 * USD, collateral: 40 * USD, yesSupply: 40, noSupply: 40 });

    h.send([await h.client.redeemPair(u.publicKey, m, 15)], [u]);
    expect(h.usdc(u.publicKey)).toBe(75 * USD);
    expect(h.collateralSnapshot(m)).toEqual({ vault: 25 * USD, collateral: 25 * USD, yesSupply: 25, noSupply: 25 });
  });

  it('rejects zero qty, insufficient funds, paused, and minting after close', async () => {
    const h = await Harness.ready();
    const m = await h.market('NVDA', 190);
    const u = h.user(10, [m]);
    h.fails([await h.client.mintPair(u.publicKey, m, 0)], [u], 'ZeroQuantity');
    h.fails([await h.client.mintPair(u.publicKey, m, 11)], [u], 'insufficient funds');
    h.send([await h.client.setPaused(h.admin.publicKey, true)], [h.admin]);
    h.fails([await h.client.mintPair(u.publicKey, m, 1)], [u], 'Paused');
    h.send([await h.client.setPaused(h.admin.publicKey, false)], [h.admin]);
    h.setTime(CLOSE);
    h.fails([await h.client.mintPair(u.publicKey, m, 1)], [u], 'MarketClosed');
  });

  it('redeem_pair still works while paused (users can always exit)', async () => {
    const h = await Harness.ready();
    const m = await h.market('TSLA', 400);
    const u = h.user(10, [m]);
    h.send([await h.client.mintPair(u.publicKey, m, 5)], [u]);
    h.send([await h.client.setPaused(h.admin.publicKey, true)], [h.admin]);
    h.send([await h.client.redeemPair(u.publicKey, m, 5)], [u]);
    expect(h.usdc(u.publicKey)).toBe(10 * USD);
  });

  it('a USDC donation to the vault does not brick the market', async () => {
    const h = await Harness.ready();
    const m = await h.market('AMZN', 240);
    const u = h.user(10, [m]);
    h.donate(u, h.client.accounts(m).vault, 1);
    h.send([await h.client.mintPair(u.publicKey, m, 2)], [u]);
    h.send([await h.client.redeemPair(u.publicKey, m, 2)], [u]);
    const s = h.collateralSnapshot(m);
    expect(s.collateral).toBe(0);
    expect(s.vault).toBe(1); // surplus stays, solvency holds
  });
});

describe('place_order / cancel_order / claim_fills', () => {
  async function setup() {
    const h = await Harness.ready();
    const m = await h.market('META', 680);
    const maker = h.user(1_000, [m]);
    const taker = h.user(1_000, [m]);
    h.send([await h.client.mintPair(maker.publicKey, m, 100)], [maker]);
    return { h, m, maker, taker };
  }

  it('resting ask escrows YES; taker bid fills at maker price with price improvement', async () => {
    const { h, m, maker, taker } = await setup();
    h.send([await h.client.placeOrder(maker.publicKey, m, 'ask', 62, 50, 'limit')], [maker]);
    expect(h.yes(maker.publicKey, m)).toBe(50);
    expect(h.tokenAmount(h.client.accounts(m).bookYes)).toBe(50);

    const meta = h.send([await h.client.placeOrder(taker.publicKey, m, 'bid', 70, 10, 'ioc')], [taker]);
    expect(h.yes(taker.publicKey, m)).toBe(10);
    expect(h.usdc(taker.publicKey)).toBe(1_000 * USD - 10 * 62 * 10_000); // paid 62¢, not 70¢
    const fill = h.events(meta).find((e) => e.name === 'fill')!;
    expect([fill.data.price, Number(fill.data.qty)]).toEqual([62, 10]);
    expect(fill.data.maker.equals(maker.publicKey)).toBe(true);

    // maker proceeds wait in escrow until claimed
    const before = h.usdc(maker.publicKey);
    h.send([await h.client.claimFills(maker.publicKey, m)], [maker]);
    expect(h.usdc(maker.publicKey) - before).toBe(10 * 62 * 10_000);
    h.fails([await h.client.claimFills(maker.publicKey, m)], [maker], 'NothingToClaim');
  });

  it('resting bid escrows USDC; cancel refunds escrow plus earned YES', async () => {
    const { h, m, maker, taker } = await setup();
    h.send([await h.client.placeOrder(taker.publicKey, m, 'bid', 40, 10, 'limit')], [taker]);
    expect(h.usdc(taker.publicKey)).toBe(1_000 * USD - 400 * 10_000);
    h.send([await h.client.placeOrder(maker.publicKey, m, 'ask', 40, 4, 'fok')], [maker]); // hits the bid
    const order = h.book(m).orders.find((o: any) => o.owner.equals(taker.publicKey))!;
    expect([Number(order.qty), Number(order.claimable)]).toEqual([6, 4]);

    h.send([await h.client.cancelOrder(taker.publicKey, m, order.seq)], [taker]);
    expect(h.usdc(taker.publicKey)).toBe(1_000 * USD - 4 * 40 * 10_000);
    expect(h.yes(taker.publicKey, m)).toBe(4);
    expect(h.tokenAmount(h.client.accounts(m).bookUsdc)).toBe(0);
  });

  it('FOK that cannot fully fill reverts with no state change', async () => {
    const { h, m, maker, taker } = await setup();
    h.send([await h.client.placeOrder(maker.publicKey, m, 'ask', 50, 3, 'limit')], [maker]);
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 50, 4, 'fok')], [taker], 'FillOrKillNotFilled');
    expect(h.usdc(taker.publicKey)).toBe(1_000 * USD);
    expect(Number(h.book(m).orders.find((o: any) => Number(o.qty) > 0)!.qty)).toBe(3);
  });

  it('rejects bad price, zero qty, someone else’s cancel, trading when paused or after close', async () => {
    const { h, m, maker, taker } = await setup();
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 0, 1, 'limit')], [taker], 'InvalidPrice');
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 100, 1, 'limit')], [taker], 'InvalidPrice');
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 50, 0, 'limit')], [taker], 'ZeroQuantity');
    h.send([await h.client.placeOrder(maker.publicKey, m, 'ask', 60, 5, 'limit')], [maker]);
    const seq = h.book(m).orders.find((o: any) => Number(o.qty) > 0)!.seq;
    h.fails([await h.client.cancelOrder(taker.publicKey, m, seq)], [taker], 'OrderNotFound');

    h.send([await h.client.setPaused(h.admin.publicKey, true)], [h.admin]);
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 60, 1, 'ioc')], [taker], 'Paused');
    h.send([await h.client.cancelOrder(maker.publicKey, m, seq)], [maker]); // exits stay open while paused
    h.send([await h.client.setPaused(h.admin.publicKey, false)], [h.admin]);

    h.setTime(CLOSE);
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 60, 1, 'ioc')], [taker], 'MarketClosed');
  });

  it('book stops taking orders max_staleness before close (no trading on public settlement prints)', async () => {
    const { h, m, taker, maker } = await setup();
    h.send([await h.client.placeOrder(maker.publicKey, m, 'ask', 60, 5, 'limit')], [maker]);
    h.setTime(CLOSE - 301);
    h.send([await h.client.placeOrder(taker.publicKey, m, 'bid', 60, 1, 'ioc')], [taker]);
    h.setTime(CLOSE - 300);
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 60, 1, 'ioc')], [taker], 'MarketClosed');
    // exits still work inside the quiet window
    h.send([await h.client.claimFills(maker.publicKey, m)], [maker]);
  });

  it('griefing fix: 64 filled-but-unclaimed slots can be cranked by anyone, paying the owner', async () => {
    const { h, m, maker, taker } = await setup();
    const griefer = h.user(10, [m]);
    h.send([await h.client.mintPair(griefer.publicKey, m, 1)], [griefer]);
    // the attack from review: rest 1 YES @1¢ then hit it yourself → slot left with qty 0, claimable 1¢
    for (let i = 0; i < 64; i++) {
      h.send(
        [await h.client.placeOrder(griefer.publicKey, m, 'ask', 1, 1, 'limit'), await h.client.placeOrder(griefer.publicKey, m, 'bid', 1, 1, 'ioc')],
        [griefer],
      );
    }
    const dead = h.book(m).orders.filter((o: any) => Number(o.qty) === 0 && Number(o.claimable) > 0);
    expect(dead).toHaveLength(64);
    h.fails([await h.client.placeOrder(maker.publicKey, m, 'ask', 60, 5, 'limit')], [maker], 'BookFull');

    // griefer closes nothing useful: crank recreates ATAs if needed; any maker cranks then quotes in ONE tx
    const usdcBefore = h.usdc(griefer.publicKey);
    const intent = await intentInstructions(h.client, maker.publicKey, m, { action: 'sellYes', qty: 5, price: 60, kind: 'limit' }, h.book(m).orders);
    h.send(intent, [maker]);
    expect(h.usdc(griefer.publicKey) - usdcBefore).toBe(10_000); // the griefer's 1¢ went back to the griefer
    expect(h.book(m).orders.some((o: any) => o.owner.equals(maker.publicKey) && Number(o.qty) === 5)).toBe(true);

    // a random cranker can't redirect funds: proceeds always go to the slot owner's ATA
    const seq = h.book(m).orders.find((o: any) => Number(o.claimable) > 0)!.seq;
    h.fails(await h.client.crankClaim(taker.publicKey, m, taker.publicKey, seq), [taker], 'OrderNotFound');
    h.send(await h.client.crankClaim(taker.publicKey, m, griefer.publicKey, seq), [taker]);
  });

  it('book holds 64 resting orders, then rejects with BookFull', async () => {
    const { h, m, taker } = await setup();
    for (let i = 0; i < 64; i++) h.send([await h.client.placeOrder(taker.publicKey, m, 'bid', 1 + (i % 50), 1, 'limit')], [taker]);
    h.fails([await h.client.placeOrder(taker.publicKey, m, 'bid', 5, 1, 'limit')], [taker], 'BookFull');
  });
});

describe('settle_market (oracle)', () => {
  async function setup(strike = 680) {
    const h = await Harness.ready();
    const m = await h.market('META', strike);
    return { h, m };
  }

  it.each([
    ['above strike → YES', 685, 'yesWon'],
    ['below strike → NO', 675, 'noWon'],
    ['exactly at strike → YES', 680, 'yesWon'],
    ['one micro-dollar below → NO', 679.99999, 'noWon'],
  ])('%s', async (_name, price, outcome) => {
    const { h, m } = await setup();
    h.setTime(CLOSE + 5);
    const pu = h.priceUpdate({ ticker: 'META', priceUsd: price as number, publishTime: CLOSE });
    h.send([await h.client.settleMarket(m, pu)], [h.admin]);
    const s = h.marketState(m);
    expect(outcome as string in s.outcome).toBe(true);
    expect(Number(s.settlePrice)).toBe(Math.round((price as number) * USD));
    expect(s.settledByOverride).toBe(false);
  });

  it('is permissionless: any signer can settle', async () => {
    const { h, m } = await setup();
    const rando = h.user();
    h.setTime(CLOSE + 1);
    h.send([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'META', priceUsd: 700, publishTime: CLOSE }))], [rando]);
  });

  it('rejects before close, stale, wide confidence, wrong feed, partial verification, wrong owner', async () => {
    const { h, m } = await setup();
    const ok = { ticker: 'META' as const, priceUsd: 700, publishTime: CLOSE };
    h.fails([await h.client.settleMarket(m, h.priceUpdate(ok))], [h.admin], 'TooEarlyToSettle');
    h.setTime(CLOSE + 600);
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ...ok, publishTime: CLOSE - 301 }))], [h.admin], 'OracleStale');
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ...ok, publishTime: CLOSE + 301 }))], [h.admin], 'OracleStale');
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ...ok, confUsd: 14.01 }))], [h.admin], 'OracleConfidenceTooWide');
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ...ok, ticker: 'TSLA' }))], [h.admin], 'OracleWrongFeed');
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ...ok, full: false }))], [h.admin], 'OracleNotFullyVerified');
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ...ok, owner: Keypair.generate().publicKey }))], [h.admin], 'OracleWrongOwner');
    // confidence exactly at the 2% limit and publish time at the window edge are accepted
    h.send([await h.client.settleMarket(m, h.priceUpdate({ ...ok, confUsd: 14, publishTime: CLOSE - 300 }))], [h.admin]);
  });

  it('outcome is immutable once written', async () => {
    const { h, m } = await setup();
    h.setTime(CLOSE + 1);
    h.send([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'META', priceUsd: 700, publishTime: CLOSE }))], [h.admin]);
    h.fails([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'META', priceUsd: 600, publishTime: CLOSE + 1 }))], [h.admin], 'AlreadySettled');
    h.setTime(CLOSE + 7200);
    h.fails([await h.client.adminSettle(h.admin.publicKey, m, 600 * USD)], [h.admin], 'AlreadySettled');
    expect('yesWon' in h.marketState(m).outcome).toBe(true);
  });
});

describe('admin_settle (override)', () => {
  it('enforces the delay after close, admin only, and flags the override', async () => {
    const h = await Harness.ready();
    const m = await h.market('MSFT', 500);
    const eve = h.user();
    h.setTime(CLOSE + 3599);
    h.fails([await h.client.adminSettle(h.admin.publicKey, m, 499 * USD)], [h.admin], 'OverrideTooEarly');
    h.setTime(CLOSE + 3600);
    h.fails([await h.client.adminSettle(eve.publicKey, m, 499 * USD)], [eve], 'Unauthorized');
    h.fails([await h.client.adminSettle(h.admin.publicKey, m, 0)], [h.admin], 'OracleBadPrice');
    h.send([await h.client.adminSettle(h.admin.publicKey, m, 499 * USD)], [h.admin]);
    const s = h.marketState(m);
    expect('noWon' in s.outcome).toBe(true);
    expect(s.settledByOverride).toBe(true);
  });
});

describe('redeem', () => {
  it('pays $1 per winning token, $0 per loser, burns both, and drains the vault exactly', async () => {
    const h = await Harness.ready();
    const m = await h.market('GOOGL', 250);
    const a = h.user(100, [m]);
    h.send([await h.client.mintPair(a.publicKey, m, 30)], [a]);
    h.fails([await h.client.redeem(a.publicKey, m)], [a], 'NotSettled');
    h.setTime(CLOSE + 2);
    h.send([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'GOOGL', priceUsd: 251.5, publishTime: CLOSE }))], [h.admin]);
    h.send([await h.client.setPaused(h.admin.publicKey, true)], [h.admin]); // redeem works while paused
    const meta = h.send([await h.client.redeem(a.publicKey, m)], [a]);
    expect(h.usdc(a.publicKey)).toBe(100 * USD); // 30 YES won → $30 back
    expect([h.yes(a.publicKey, m), h.no(a.publicKey, m)]).toEqual([0, 0]);
    expect(h.collateralSnapshot(m)).toEqual({ vault: 0, collateral: 0, yesSupply: 0, noSupply: 0 });
    const ev = h.events(meta).find((e) => e.name === 'redeemed')!;
    expect(Number(ev.data.payout)).toBe(30 * USD);
    h.fails([await h.client.redeem(a.publicKey, m)], [a], 'ZeroQuantity');
  });
});
