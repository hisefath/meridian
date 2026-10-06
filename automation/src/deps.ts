// Production wiring of the job dependencies (Hermes, RPC, Pyth receiver, alerts).
import { Wallet } from '@coral-xyz/anchor';
import { PythSolanaReceiver } from '@pythnetwork/pyth-solana-receiver';
import { outcomeOf } from '@meridian/sdk';
import { admin, client, connection, env, send } from './chain';
import { Hermes } from './hermes';
import type { Deps, Settings } from './jobs';

export const hermes = new Hermes(process.env.PYTH_API_KEY || undefined, env('HERMES_URL', 'https://pyth.dourolabs.app/hermes'));
const webhook = process.env.ALERT_WEBHOOK_URL;

export const settings: Settings = {
  strikePcts: env('STRIKE_PCTS', '3,6,9').split(',').map(Number),
  includeAtm: env('INCLUDE_ATM', 'true') === 'true',
  prevCloses: Object.fromEntries(
    (process.env.PREV_CLOSES ?? '')
      .split(',')
      .filter(Boolean)
      .map((kv) => kv.split('=').map((x) => x.trim()))
      .map(([k, v]) => [k, Number(v)]),
  ),
  maxStalenessSecs: Number(env('MAX_STALENESS_SECS', '300')),
  maxConfBps: Number(env('MAX_CONF_BPS', '200')),
  settleRetryWindowSecs: Number(env('SETTLE_RETRY_WINDOW_SECS', '900')),
};

export const deps: Deps = {
  client,
  admin: admin.publicKey,
  hermes,
  send,
  exists: async (pk) => (await connection.getAccountInfo(pk)) !== null,
  openMarkets: async () =>
    (await client.fetchMarkets())
      .filter((m) => outcomeOf(m.account) === 'open')
      .map((m) => ({ pubkey: m.publicKey, ticker: m.account.ticker, closeTs: m.account.closeTs.toNumber(), strike: BigInt(m.account.strike.toString()) })),
  settleWith: async (update, markets) => {
    const receiver = new PythSolanaReceiver({ connection, wallet: new Wallet(admin) as any });
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
    await builder.addPostPriceUpdates([update.binary]); // full Wormhole verification
    await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => {
      const account = getPriceUpdateAccount('0x' + update.feedId);
      return Promise.all(markets.map(async (m) => ({ instruction: await client.settleMarket(m, account), signers: [] })));
    });
    const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 10_000, tightComputeBudget: true });
    await receiver.provider.sendAll(txs, { skipPreflight: true });
    for (const m of markets) {
      if (outcomeOf(await client.fetchMarket(m)) === 'open') throw new Error(`market ${m.toBase58()} still open after settle txs`);
    }
  },
  alert: async (level, msg, ctx) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx });
    (level === 'info' ? console.log : console.error)(line);
    if (webhook && level !== 'info') {
      await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `[meridian ${level}] ${msg}`, content: `[meridian ${level}] ${msg}` }) }).catch(() => {});
    }
  },
  now: () => Math.floor(Date.now() / 1000),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

