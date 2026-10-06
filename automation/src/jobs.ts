import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { FEED_IDS, MICRO, TICKERS, computeStrikes, type MeridianClient } from '@meridian/sdk';
import { acceptable, toMicro, type Hermes, type PriceUpdate } from './hermes';

export interface Deps {
  client: MeridianClient;
  admin: PublicKey;
  hermes: Pick<Hermes, 'marketHours' | 'latest' | 'at' | 'hasKey'>;
  send(ixs: TransactionInstruction[]): Promise<string>;
  exists(account: PublicKey): Promise<boolean>;
  openMarkets(): Promise<{ pubkey: PublicKey; ticker: number; closeTs: number; strike: bigint }[]>;
  /** Post the update through the Pyth receiver and settle the given markets with it. */
  settleWith(update: PriceUpdate, markets: PublicKey[]): Promise<void>;
  alert(level: 'info' | 'warn' | 'error', msg: string, ctx?: object): Promise<void>;
  /** chain time (unix secs): decisions must match what the program will check */
  now(): Promise<number>;
  sleep(ms: number): Promise<void>;
}

export interface Settings {
  strikePcts: number[];
  includeAtm: boolean;
  /** manual previous closes in USD, used when no Pyth API key is configured */
  prevCloses: Partial<Record<string, number>>;
  maxStalenessSecs: number;
  maxConfBps: number;
  /** how long the settler keeps retrying an oracle failure before asking for an override */
  settleRetryWindowSecs: number;
}

const etDate = (unix: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(unix * 1000);

export async function withRetry<T>(deps: Pick<Deps, 'sleep'>, fn: () => Promise<T>, attempts = 4, baseMs = 2_000): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= attempts) throw e;
      await deps.sleep(baseMs * 2 ** i); // 2s, 4s, 8s
    }
  }
}

/**
 * Today's session close (unix secs) if today is a trading day, else null.
 * Uses Pyth's market-hours metadata, which already knows holidays and early closes.
 */
export async function todaysClose(deps: Deps): Promise<number | null> {
  const h = await deps.hermes.marketHours(FEED_IDS.AAPL);
  const now = await deps.now();
  if (h.nextClose && etDate(h.nextClose) === etDate(now) && h.nextClose > now) return h.nextClose;
  return null;
}

async function prevCloseMicro(deps: Deps, s: Settings, ticker: string): Promise<bigint> {
  const manual = s.prevCloses[ticker];
  if (manual) return BigInt(Math.round(manual * MICRO));
  if (!deps.hermes.hasKey) throw new Error(`no PYTH_API_KEY and no PREV_CLOSES entry for ${ticker}`);
  // Regular-session equity feeds stop publishing at the close, so before the open
  // "latest" is the previous session's last print.
  const u = await deps.hermes.latest(FEED_IDS[ticker as keyof typeof FEED_IDS]);
  if (!u) throw new Error(`no Pyth price for ${ticker}`);
  return toMicro(u.price, u.expo);
}

/**
 * Morning job: for each stock, strikes from the previous close, one market per strike.
 * Idempotent: a strike whose PDA already exists is skipped, so re-runs only fill gaps.
 */
export async function morning(deps: Deps, s: Settings, closeTs?: number) {
  const close = closeTs ?? (await todaysClose(deps));
  if (!close) {
    await deps.alert('info', 'morning job: not a trading day, nothing to create');
    return { created: 0, skipped: 0, failed: 0 };
  }
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const [t, ticker] of TICKERS.entries()) {
    let strikes: bigint[];
    try {
      strikes = computeStrikes(await withRetry(deps, () => prevCloseMicro(deps, s, ticker)), s.strikePcts, s.includeAtm);
    } catch (e) {
      failed++;
      await deps.alert('error', `morning job: cannot price ${ticker}`, { error: String(e) });
      continue;
    }
    for (const strike of strikes) {
      const market = deps.client.marketAddress(t, close, strike);
      if (await deps.exists(market)) {
        skipped++;
        continue;
      }
      try {
        await withRetry(deps, async () => deps.send([await deps.client.createStrikeMarket(deps.admin, t, strike, close)]));
        created++;
      } catch (e) {
        failed++;
        await deps.alert('error', `morning job: create ${ticker} > $${Number(strike) / MICRO} failed`, { error: String(e) });
      }
    }
  }
  await deps.alert(failed ? 'error' : 'info', `morning job done: ${created} created, ${skipped} existed, ${failed} failed`, { close });
  return { created, skipped, failed };
}

/** Prefer the update at the close itself; fall back to the latest one if it's still inside the window. */
async function closingUpdate(deps: Deps, feedId: string, closeTs: number) {
  const atClose = await deps.hermes.at(feedId, closeTs).catch(() => null);
  if (atClose) return atClose;
  return deps.hermes.latest(feedId);
}

/** Settlement failures we're retrying, keyed by `${ticker}:${closeTs}` → first failure time. */
export type SettleState = Map<string, { since: number; escalated: boolean }>;

/**
 * Settler tick (every 30s): settle every open market whose close has passed. One
 * posted Pyth update per (ticker, close) settles all of that stock's strikes.
 * Driven by on-chain state, so it is idempotent and catches up after a restart.
 */
export async function settleTick(deps: Deps, s: Settings, state: SettleState) {
  const now = await deps.now();
  const due = (await deps.openMarkets()).filter((m) => m.closeTs <= now);
  const groups = new Map<string, typeof due>();
  for (const m of due) {
    const k = `${m.ticker}:${m.closeTs}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  let settled = 0;
  for (const [key, markets] of groups) {
    const [t, close] = key.split(':').map(Number);
    const ticker = TICKERS[t];
    try {
      if (!deps.hermes.hasKey) throw new Error('PYTH_API_KEY not configured');
      const u = await closingUpdate(deps, FEED_IDS[ticker], close);
      if (!u) throw new Error('no price update available');
      const why = acceptable(u, close, s.maxStalenessSecs, s.maxConfBps);
      if (why) throw new Error(why);
      await deps.settleWith(u, markets.map((m) => m.pubkey));
      settled += markets.length;
      state.delete(key);
      await deps.alert('info', `settled ${markets.length} ${ticker} market(s) at $${Number(toMicro(u.price, u.expo)) / MICRO}`, { close });
    } catch (e) {
      const f = state.get(key) ?? { since: now, escalated: false };
      state.set(key, f);
      const waited = now - f.since;
      if (waited >= s.settleRetryWindowSecs && !f.escalated) {
        f.escalated = true;
        await deps.alert('error', `${ticker} settlement failing for ${Math.round(waited / 60)} min — admin override required after the delay`, {
          markets: markets.map((m) => m.pubkey.toBase58()),
          error: String(e),
        });
      } else if (!f.escalated) {
        await deps.alert('warn', `${ticker} settlement attempt failed, retrying in 30s`, { error: String(e) });
      }
    }
  }
  return settled;
}
