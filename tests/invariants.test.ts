// Randomised invariant test: after EVERY operation, collateral accounting is exact
// and escrow matches what the book owes; after settlement + full redemption the
// vault is empty and no USDC was created or destroyed.
import { describe, expect, it } from 'vitest';
import type { Keypair, PublicKey } from '@solana/web3.js';
import { USDC_PER_CENT } from '../sdk/src';
import { CLOSE, Harness, TxError, USD } from './harness';

function rng(seed: number) {
  return () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
}

function checkInvariants(h: Harness, m: PublicKey) {
  const s = h.collateralSnapshot(m);
  // vault = collateral = $1 × pairs (YES supply = NO supply while open)
  expect(s.vault).toBe(s.collateral);
  expect(s.collateral).toBe(s.yesSupply * USD);
  expect(s.yesSupply).toBe(s.noSupply);
  // escrow = everything the book owes its slot owners
  let owedUsdc = 0;
  let owedYes = 0;
  for (const o of h.book(m).orders as any[]) {
    const qty = Number(o.qty);
    const claim = Number(o.claimable);
    if (o.side === 0) {
      owedUsdc += qty * o.price * USDC_PER_CENT;
      owedYes += claim;
    } else {
      owedYes += qty;
      owedUsdc += claim;
    }
  }
  const a = h.client.accounts(m);
  expect(h.tokenAmount(a.bookUsdc)).toBe(owedUsdc);
  expect(h.tokenAmount(a.bookYes)).toBe(owedYes);
}

describe('invariants under random operation sequences', () => {
  for (const seed of [1, 7, 42]) {
    it(`seed ${seed}: 150 random ops keep vault == $1 × pairs and escrow == owed`, async () => {
      const r = rng(seed);
      const h = await Harness.ready();
      const m = await h.market('TSLA', 400);
      const users: Keypair[] = [0, 1, 2].map(() => h.user(500, [m]));
      const totalUsdc = () =>
        users.reduce((s, u) => s + h.usdc(u.publicKey), 0) + h.tokenAmount(h.client.accounts(m).vault) + h.tokenAmount(h.client.accounts(m).bookUsdc);
      const start = totalUsdc();
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

      let ok = 0;
      for (let i = 0; i < 150; i++) {
        const u = pick(users);
        const qty = 1 + Math.floor(r() * 8);
        const price = 1 + Math.floor(r() * 99);
        const op = Math.floor(r() * 6);
        try {
          if (op === 0) h.send([await h.client.mintPair(u.publicKey, m, qty)], [u]);
          else if (op === 1) h.send([await h.client.redeemPair(u.publicKey, m, qty)], [u]);
          else if (op === 2 || op === 3) {
            const kind = pick(['limit', 'ioc', 'fok'] as const);
            h.send([await h.client.placeOrder(u.publicKey, m, op === 2 ? 'bid' : 'ask', price, qty, kind)], [u]);
          } else if (op === 4) {
            const mine = (h.book(m).orders as any[]).filter((o) => o.owner.equals(u.publicKey) && (Number(o.qty) > 0 || Number(o.claimable) > 0));
            if (!mine.length) continue;
            h.send([await h.client.cancelOrder(u.publicKey, m, pick(mine).seq)], [u]);
          } else h.send([await h.client.claimFills(u.publicKey, m)], [u]);
          ok++;
        } catch (e) {
          if (!(e instanceof TxError)) throw e; // expected rejections (no funds, nothing to claim…) are fine
        }
        checkInvariants(h, m);
        expect(totalUsdc()).toBe(start);
      }
      expect(ok).toBeGreaterThan(40);

      // settle at a random price, everyone exits, vault ends at exactly zero
      h.setTime(CLOSE + 1);
      const price = 380 + r() * 40;
      h.send([await h.client.settleMarket(m, h.priceUpdate({ ticker: 'TSLA', priceUsd: price, publishTime: CLOSE }))], [h.admin]);
      for (const u of users) {
        for (const o of (h.book(m).orders as any[]).filter((o) => o.owner.equals(u.publicKey) && (Number(o.qty) > 0 || Number(o.claimable) > 0))) {
          h.send([await h.client.cancelOrder(u.publicKey, m, o.seq)], [u]);
        }
        if (h.yes(u.publicKey, m) + h.no(u.publicKey, m) > 0) h.send([await h.client.redeem(u.publicKey, m)], [u]);
      }
      expect(h.collateralSnapshot(m)).toEqual({ vault: 0, collateral: 0, yesSupply: 0, noSupply: 0 });
      expect(totalUsdc()).toBe(start);
    });
  }
});
