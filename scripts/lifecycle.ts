// End-to-end lifecycle on a live cluster (devnet by default):
//   create market → fund users → mint → quote → all 4 trade paths → close → settle → redeem
// Settles through Pyth when PYTH_API_KEY is set (run during US market hours so the
// feed is live), otherwise waits out the override delay and uses admin_settle.
// Writes a markdown transcript with explorer links to docs/devnet-lifecycle-run.md.
import { writeFileSync } from 'node:fs';
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, type PublicKey } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount } from '@solana/spl-token';
import { FEED_IDS, MICRO, TICKERS, ata, intentInstructions, outcomeOf, type TradeIntent } from '@meridian/sdk';
import { admin, chainNow, client, connection, env, explorer, loadKeypair, send, usdcMint } from '../automation/src/chain';
import { deps, hermes, settings } from '../automation/src/deps';
import { settleTick, todaysClose } from '../automation/src/jobs';
import { toMicro } from '../automation/src/hermes';

const log: string[] = [`# Devnet lifecycle run — ${new Date().toISOString()}`, '', `Program \`${client.programId.toBase58()}\` · RPC ${connection.rpcEndpoint}`, ''];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const step = async (label: string, p: Promise<string>) => {
  const sig = await p;
  say(`- ${label} — [tx](${explorer(sig)})`);
  return sig;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitUntilChain = async (t: number) => {
  while ((await chainNow()) < t) await sleep(3_000);
};
const bal = async (a: PublicKey) => Number((await getAccount(connection, a).catch(() => ({ amount: 0n }))).amount);

const ticker = (process.env.TICKER ?? 'META') as (typeof TICKERS)[number];
const t = TICKERS.indexOf(ticker);
const minutes = Number(env('CLOSE_IN_MINUTES', '3'));

// strike = current price rounded to $10 (ATM) when we can price it, else STRIKE env
let strikeUsd = Number(process.env.STRIKE ?? 0);
if (!strikeUsd && hermes.hasKey) {
  const u = await hermes.latest(FEED_IDS[ticker]);
  strikeUsd = Math.round(Number(toMicro(u!.price, u!.expo)) / MICRO / 10) * 10;
}
if (!strikeUsd) strikeUsd = 680;
const close = (await chainNow()) + minutes * 60;
const market = client.marketAddress(t, close, strikeUsd * MICRO);

say(`## 1. Create market "${ticker} ≥ $${strikeUsd}" closing ${new Date(close * 1000).toISOString()}`);
await step(`add_strike → market \`${market.toBase58()}\``, send([await client.createStrikeMarket(admin.publicKey, t, strikeUsd * MICRO, close, true)]));

say('## 2. Fund a market maker and a trader (SOL for fees + test USDC)');
const mm = loadKeypair(env('MM_KEYPAIR', 'keys/mm.json'));
const trader = loadKeypair(env('TRADER_KEYPAIR', 'keys/trader.json'));
for (const u of [mm, trader]) {
  const ixs = [];
  if ((await connection.getBalance(u.publicKey)) < 0.05 * LAMPORTS_PER_SOL)
    ixs.push(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: u.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }));
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(u.publicKey, usdcMint), u.publicKey, usdcMint),
    createMintToInstruction(usdcMint, ata(u.publicKey, usdcMint), admin.publicKey, 100 * MICRO),
  );
  await step(`fund ${u === mm ? 'MM' : 'trader'} ${u.publicKey.toBase58().slice(0, 8)}… with 100 test USDC`, send(ixs));
}
const start = { mm: await bal(ata(mm.publicKey, usdcMint)), trader: await bal(ata(trader.publicKey, usdcMint)) };

say('## 3. Market maker mints pairs and quotes YES 55 / 60');
await step('MM mint_pair ×40 ($40 into the vault)', send([...client.ensureTokenAccounts(mm.publicKey, mm.publicKey, market), await client.mintPair(mm.publicKey, market, 40)], [mm]));
await step('MM ask YES 20 @ 60¢', send([await client.placeOrder(mm.publicKey, market, 'ask', 60, 20, 'limit')], [mm]));
await step('MM bid YES 20 @ 55¢', send([await client.placeOrder(mm.publicKey, market, 'bid', 55, 20, 'limit')], [mm]));

say('## 4. Trader runs all four trade paths (each is ONE transaction / signature)');
const tradeOnce = async (label: string, intent: TradeIntent) =>
  step(label, send(await intentInstructions(client, trader.publicKey, market, intent), [trader]));
await tradeOnce('Buy YES ×5 (market, ≤ 60¢)', { action: 'buyYes', qty: 5, price: 60, kind: 'market' });
await tradeOnce('Sell YES ×2 (market, ≥ 55¢)', { action: 'sellYes', qty: 2, price: 55, kind: 'market' });
await tradeOnce('Sell YES ×3 to flatten', { action: 'sellYes', qty: 3, price: 55, kind: 'market' });
await tradeOnce('Buy NO ×4 (mint pair + sell YES @ 55 → NO costs 45¢)', { action: 'buyNo', qty: 4, price: 45, kind: 'market' });
await tradeOnce('Sell NO ×1 (buy YES @ 60 + merge pair → +40¢)', { action: 'sellNo', qty: 1, price: 40, kind: 'market' });
say(`- trader now holds ${await bal(ata(trader.publicKey, client.accounts(market).yesMint))} YES / ${await bal(ata(trader.publicKey, client.accounts(market).noMint))} NO`);

say(`## 5. Wait for close (${minutes} min) — trading halts on-chain at close_ts`);
await waitUntilChain(close + 1);

say('## 6. Settle');
const cfg = await client.fetchConfig();
if (hermes.hasKey) {
  await settleTick(deps, settings, new Map());
} else {
  const until = close + cfg.overrideDelaySecs;
  say(`- no PYTH_API_KEY: oracle path unavailable → admin override unlocks at ${new Date(until * 1000).toISOString()}`);
  await waitUntilChain(until + 1);
  const price = BigInt(Number(process.env.OVERRIDE_PRICE ?? strikeUsd - 1) * MICRO);
  await step(`admin_settle at $${Number(price) / MICRO}`, send([await client.adminSettle(admin.publicKey, market, price)]));
}
const m = await client.fetchMarket(market);
say(`- outcome: **${outcomeOf(m)}** at $${Number(m.settlePrice) / MICRO} (override: ${m.settledByOverride})`);

say('## 7. Makers withdraw, everyone redeems');
const book = await client.fetchBook(market);
const mine = book.orders.filter((o) => o.owner.equals(mm.publicKey) && Number(o.qty) > 0);
if (book.orders.some((o) => o.owner.equals(mm.publicKey) && Number(o.claimable) > 0))
  await step('MM claim_fills', send([await client.claimFills(mm.publicKey, market)], [mm]));
for (const o of mine) await step(`MM cancel order #${o.seq}`, send([await client.cancelOrder(mm.publicKey, market, o.seq)], [mm]));
for (const [name, u] of [['MM', mm], ['trader', trader]] as [string, Keypair][]) {
  const a = client.accounts(market);
  if ((await bal(ata(u.publicKey, a.yesMint))) + (await bal(ata(u.publicKey, a.noMint))) > 0)
    await step(`${name} redeem`, send([await client.redeem(u.publicKey, market)], [u]));
}

const a = client.accounts(market);
const end = { mm: await bal(ata(mm.publicKey, usdcMint)), trader: await bal(ata(trader.publicKey, usdcMint)) };
const vault = await bal(a.vault);
const after = await client.fetchMarket(market);
say('## 8. Invariants');
say(`- vault balance: ${vault} (collateral ${after.collateral}) — must be 0`);
say(`- USDC conserved between the two users: ${end.mm + end.trader - start.mm - start.trader === 0 ? 'yes' : 'NO'} (MM ${(end.mm - start.mm) / MICRO >= 0 ? '+' : ''}${(end.mm - start.mm) / MICRO}, trader ${(end.trader - start.trader) / MICRO >= 0 ? '+' : ''}${(end.trader - start.trader) / MICRO})`);
writeFileSync(process.env.RUN_LOG ?? 'docs/devnet-lifecycle-run.md', log.join('\n') + '\n');
if (vault !== 0 || end.mm + end.trader !== start.mm + start.trader) process.exit(1);
