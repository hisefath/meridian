// Meridian automation service.
//   run       — long-running scheduler: morning job at MORNING_ET, settler every 30s
//   morning   — run the morning job once
//   settle    — run one settler pass
//   override  — admin_settle: --market <pubkey> --price <usd>
//   demo      — create one market closing soon: --ticker META --strike 680 --minutes 10
import { PublicKey } from '@solana/web3.js';
import { FEED_IDS, MICRO, TICKERS } from '@meridian/sdk';
import { admin, chainNow, client, env, send } from './chain';
import { deps, hermes, settings } from './deps';
import { morning, settleTick, type SettleState } from './jobs';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const etClock = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const etDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

async function run() {
  const morningAt = env('MORNING_ET', '08:00');
  const state: SettleState = new Map();
  let morningDoneFor = '';
  await deps.alert('info', `automation up: admin ${admin.publicKey.toBase58()}, program ${client.programId.toBase58()}, pyth key ${hermes.hasKey ? 'set' : 'MISSING'}`);
  for (;;) {
    try {
      if (etClock() >= morningAt && morningDoneFor !== etDay()) {
        const r = await morning(deps, settings);
        if (r.failed === 0) morningDoneFor = etDay(); // otherwise retry next tick
      }
      await settleTick(deps, settings, state);
    } catch (e) {
      await deps.alert('error', 'scheduler tick failed', { error: String(e) });
    }
    await deps.sleep(30_000);
  }
}

async function main() {
  const cmd = process.argv[2] ?? 'run';
  if (cmd === 'run') return run();
  if (cmd === 'morning') return console.log(await morning(deps, settings));
  if (cmd === 'settle') return console.log({ settled: await settleTick(deps, settings, new Map()) });
  if (cmd === 'override') {
    const market = new PublicKey(arg('market')!);
    const price = BigInt(Math.round(Number(arg('price')) * MICRO));
    console.log(await send([await client.adminSettle(admin.publicKey, market, price)]));
    return;
  }
  if (cmd === 'demo') {
    const t = TICKERS.indexOf((arg('ticker') ?? 'META') as (typeof TICKERS)[number]);
    const strike = BigInt(Math.round(Number(arg('strike')) * MICRO));
    const close = (await chainNow()) + Number(arg('minutes') ?? '10') * 60;
    await send([await client.createStrikeMarket(admin.publicKey, t, strike, close, true)]);
    console.log({ market: client.marketAddress(t, close, strike).toBase58(), close: new Date(close * 1000).toISOString(), feed: FEED_IDS[TICKERS[t]] });
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
