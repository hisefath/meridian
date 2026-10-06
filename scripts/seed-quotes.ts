// Demo liquidity: a market maker mints pairs and quotes a two-level YES ladder around a
// fair value on every open market (localnet / devnet demos only).
// Fair value = P(close ≥ strike) under a normal move with 2% daily vol from PREV_CLOSES.
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction } from '@solana/spl-token';
import { MICRO, TICKERS, ata, outcomeOf } from '@meridian/sdk';
import { admin, chainNow, client, env, loadKeypair, send, usdcMint } from '../automation/src/chain';
import { settings } from '../automation/src/deps';

const mm = loadKeypair(env('MM_KEYPAIR', 'keys/mm.json'));
const PAIRS = Number(process.env.SEED_PAIRS ?? 30);

const phi = (x: number) => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x ** 3))); // normal CDF approx
const clamp = (p: number) => Math.max(1, Math.min(99, Math.round(p)));

const now = await chainNow();
const open = (await client.fetchMarkets()).filter((m) => outcomeOf(m.account) === 'open' && Number(m.account.closeTs) > now);
console.log(`${open.length} open markets`);

await send([
  SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: mm.publicKey, lamports: 2 * LAMPORTS_PER_SOL }),
  createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(mm.publicKey, usdcMint), mm.publicKey, usdcMint),
  createMintToInstruction(usdcMint, ata(mm.publicKey, usdcMint), admin.publicKey, open.length * PAIRS * 2 * MICRO),
]);

for (const { publicKey: market, account: m } of open) {
  const ticker = TICKERS[m.ticker];
  const prev = settings.prevCloses[ticker];
  if (!prev) continue;
  const strike = Number(m.strike) / MICRO;
  const fair = 100 * phi((prev - strike) / (prev * 0.02));
  const bid = clamp(fair - 2);
  const ask = Math.max(bid + 1, clamp(fair + 2));
  const ixs = [...client.ensureTokenAccounts(mm.publicKey, mm.publicKey, market), await client.mintPair(mm.publicKey, market, PAIRS)];
  if (ask <= 99) ixs.push(await client.placeOrder(mm.publicKey, market, 'ask', ask, 10, 'limit'));
  if (ask + 3 <= 99) ixs.push(await client.placeOrder(mm.publicKey, market, 'ask', ask + 3, 15, 'limit'));
  if (bid >= 1) ixs.push(await client.placeOrder(mm.publicKey, market, 'bid', bid, 10, 'limit'));
  if (bid - 3 >= 1) ixs.push(await client.placeOrder(mm.publicKey, market, 'bid', bid - 3, 15, 'limit'));
  await send(ixs, [admin, mm]);
  console.log(`${ticker} ≥ $${strike}: fair ${fair.toFixed(1)}¢ → bid ${bid} / ask ${ask}`);
}
