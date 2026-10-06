import { describe, expect, it } from 'vitest';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { MeridianClient, createProgram } from '@meridian/sdk';
import { acceptable, toMicro, type PriceUpdate } from './hermes';
import { morning, settleTick, type Deps, type SettleState, type Settings } from './jobs';

const CLOSE = 1_791_316_800; // 2026-10-06 16:00 ET
const settings: Settings = {
  strikePcts: [3, 6, 9],
  includeAtm: true,
  prevCloses: {},
  maxStalenessSecs: 300,
  maxConfBps: 200,
  settleRetryWindowSecs: 900,
};

const update = (o: Partial<PriceUpdate> = {}): PriceUpdate => ({
  feedId: 'f'.repeat(64),
  price: 68_000_000n,
  conf: 10_000n,
  expo: -5,
  publishTime: CLOSE,
  binary: 'AAAA',
  ...o,
});

function fakeDeps(over: Partial<Deps> = {}) {
  const client = new MeridianClient(createProgram(), Keypair.generate().publicKey);
  const created = new Set<string>();
  const alerts: { level: string; msg: string }[] = [];
  let now = CLOSE - 8 * 3600; // 08:00 ET
  const deps: Deps = {
    client,
    admin: Keypair.generate().publicKey,
    hermes: {
      hasKey: true,
      marketHours: async () => ({ isOpen: false, nextOpen: CLOSE - 23_400, nextClose: CLOSE }),
      latest: async () => update(),
      at: async () => update(),
    },
    send: async (ixs) => {
      // createStrikeMarket: market PDA is account #2
      created.add(ixs[0].keys[2].pubkey.toBase58());
      return 'sig';
    },
    exists: async (pk: PublicKey) => created.has(pk.toBase58()),
    openMarkets: async () => [],
    settleWith: async () => {},
    alert: async (level, msg) => void alerts.push({ level, msg }),
    now: async () => now,
    sleep: async () => {},
    ...over,
  };
  return { deps, created, alerts, setNow: (t: number) => (now = t) };
}

describe('morning job', () => {
  it('creates de-duplicated strikes for all 7 stocks and is idempotent', async () => {
    const { deps, created } = fakeDeps();
    const r1 = await morning(deps, settings);
    // prev close $680 for every ticker → 7 strikes each
    expect(r1).toEqual({ created: 49, skipped: 0, failed: 0 });
    const r2 = await morning(deps, settings);
    expect(r2).toEqual({ created: 0, skipped: 49, failed: 0 });
    expect(created.size).toBe(49);
  });

  it('does nothing on a non-trading day (calendar from Pyth market hours)', async () => {
    const { deps, created } = fakeDeps({
      hermes: { hasKey: true, marketHours: async () => ({ isOpen: false, nextOpen: CLOSE + 3 * 86_400, nextClose: CLOSE + 3 * 86_400 + 23_400 }), latest: async () => update(), at: async () => update() },
    });
    expect(await morning(deps, settings)).toEqual({ created: 0, skipped: 0, failed: 0 });
    expect(created.size).toBe(0);
  });

  it('retries a failing send with backoff, then counts and alerts the failure', async () => {
    let calls = 0;
    const { deps, alerts } = fakeDeps({
      send: async () => {
        calls++;
        throw new Error('rpc down');
      },
    });
    const r = await morning({ ...deps }, { ...settings, strikePcts: [] }); // ATM only → 7 markets
    expect(r.failed).toBe(7);
    expect(calls).toBe(7 * 4);
    expect(alerts.some((a) => a.level === 'error')).toBe(true);
  });

  it('works without a Pyth key when PREV_CLOSES are provided', async () => {
    const { deps } = fakeDeps();
    deps.hermes = { ...deps.hermes, hasKey: false };
    const prev = { AAPL: 230, MSFT: 500, GOOGL: 250, AMZN: 240, NVDA: 190, META: 680, TSLA: 400 };
    const r = await morning(deps, { ...settings, prevCloses: prev });
    expect(r.failed).toBe(0);
    expect(r.created).toBe(5 + 7 + 5 + 5 + 5 + 7 + 7); // AAPL 230 dedupes to 5 strikes, as in the brief
  });
});

describe('settler', () => {
  const market = (ticker: number) => ({ pubkey: Keypair.generate().publicKey, ticker, closeTs: CLOSE, strike: 680_000_000n });

  it('settles all strikes of a ticker with one update once the close has passed', async () => {
    const ms = [market(5), market(5), market(0)];
    const settledWith: number[] = [];
    const { deps, setNow } = fakeDeps({ openMarkets: async () => ms, settleWith: async (_u, mk) => void settledWith.push(mk.length) });
    setNow(CLOSE - 1);
    expect(await settleTick(deps, settings, new Map())).toBe(0); // not closed yet
    setNow(CLOSE + 5);
    expect(await settleTick(deps, settings, new Map())).toBe(3);
    expect(settledWith.sort()).toEqual([1, 2]);
  });

  it('retries a wide-confidence price and escalates once after 15 minutes', async () => {
    const { deps, alerts, setNow } = fakeDeps({
      openMarkets: async () => [market(5)],
      hermes: { hasKey: true, marketHours: async () => ({ isOpen: false, nextOpen: null, nextClose: null }), latest: async () => update({ conf: 2_000_000n }), at: async () => update({ conf: 2_000_000n }) },
    });
    const state: SettleState = new Map();
    for (let t = CLOSE + 5; t <= CLOSE + 5 + 900; t += 30) {
      setNow(t);
      await settleTick(deps, settings, state);
    }
    expect(alerts.filter((a) => a.level === 'error')).toHaveLength(1);
    expect(alerts.filter((a) => a.level === 'error')[0].msg).toMatch(/override required/);
    expect(alerts.filter((a) => a.level === 'warn').length).toBeGreaterThan(25);
  });
});

describe('oracle acceptance (mirrors settle_market)', () => {
  it('window is measured from the close, confidence in bps', () => {
    expect(acceptable(update({ publishTime: CLOSE - 300 }), CLOSE, 300, 200)).toBeNull();
    expect(acceptable(update({ publishTime: CLOSE + 301 }), CLOSE, 300, 200)).toMatch(/stale/);
    expect(acceptable(update({ conf: 1_360_000n }), CLOSE, 300, 200)).toBeNull(); // exactly 2%
    expect(acceptable(update({ conf: 1_360_001n }), CLOSE, 300, 200)).toMatch(/confidence/);
    expect(toMicro(68_000_000_123n, -8)).toBe(680_000_001n);
  });
});
