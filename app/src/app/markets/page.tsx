'use client';
import Link from 'next/link';
import { TICKERS } from '@meridian/sdk';
import { Countdown } from '@/components/Countdown';
import { useMarkets, usePrices } from '@/lib/meridian';

const NAMES: Record<string, string> = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  GOOGL: 'Alphabet',
  AMZN: 'Amazon',
  NVDA: 'NVIDIA',
  META: 'Meta Platforms',
  TSLA: 'Tesla',
};

export default function Markets() {
  const { markets, error } = useMarkets();
  const { prices } = usePrices();
  const now = Math.floor(Date.now() / 1000);
  return (
    <div>
      <h1 className="text-2xl font-bold">Markets</h1>
      <p className="mt-1 text-sm text-gray-400">Today’s strike contracts per stock. Strikes are created automatically before the open and settle at the close.</p>
      {error && <p className="mt-4 text-no">Could not load markets: {error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TICKERS.map((t) => {
          const mine = (markets ?? []).filter((m) => m.ticker === t);
          const active = mine.filter((m) => m.outcome === 'open' && m.closeTs > now);
          const next = active.map((m) => m.closeTs).sort((a, b) => a - b)[0];
          const p = prices[t];
          return (
            <Link key={t} href={`/trade/${t}`} className="rounded-xl border border-line bg-panel p-4 hover:border-gray-500">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-bold">{t}</span>
                <span className="num text-lg">{p ? `$${p.price.toFixed(2)}` : '—'}</span>
              </div>
              <div className="text-sm text-gray-400">{NAMES[t]}</div>
              <div className="mt-3 text-sm">
                <span className="num font-semibold">{markets ? active.length : '…'}</span> active contract{active.length === 1 ? '' : 's'}
                {mine.length > active.length && <span className="text-gray-500"> · {mine.length - active.length} closed</span>}
              </div>
              <div className="mt-1 text-xs text-gray-400">{next ? <Countdown closeTs={next} outcome="open" /> : 'No open contracts'}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
