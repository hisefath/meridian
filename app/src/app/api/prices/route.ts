// Hermes proxy: the browser polls this, the Pyth API key never leaves the server.
import { NextResponse } from 'next/server';
import { FEED_IDS, TICKERS } from '@meridian/sdk';

const HERMES = process.env.HERMES_URL ?? 'https://pyth.dourolabs.app/hermes';
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  const key = process.env.PYTH_API_KEY;
  if (!key) return NextResponse.json({ error: 'PYTH_API_KEY is not configured on the server' }, { status: 503 });
  if (cache && Date.now() - cache.at < 2_000) return NextResponse.json(cache.body);
  const ids = TICKERS.map((t) => `ids[]=${FEED_IDS[t]}`).join('&');
  const res = await fetch(`${HERMES}/v2/updates/price/latest?${ids}&parsed=true`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ error: `Hermes ${res.status}` }, { status: 502 });
  const parsed: any[] = (await res.json()).parsed ?? [];
  const prices = Object.fromEntries(
    TICKERS.map((t) => {
      const p = parsed.find((x) => x.id === FEED_IDS[t])?.price;
      return [t, p && { price: Number(p.price) * 10 ** p.expo, conf: Number(p.conf) * 10 ** p.expo, publishTime: p.publish_time }];
    }),
  );
  cache = { at: Date.now(), body: { prices } };
  return NextResponse.json(cache.body);
}
