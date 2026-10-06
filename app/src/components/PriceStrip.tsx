'use client';
import { TICKERS, type Ticker } from '@meridian/sdk';
import type { OraclePrice } from '@/lib/meridian';

/** Live MAG7 prices from the Pyth oracle. */
export function PriceStrip({ prices, error }: { prices: Partial<Record<Ticker, OraclePrice>>; error: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {TICKERS.map((t) => {
        const p = prices[t];
        const age = p ? Math.max(0, Math.floor(Date.now() / 1000) - p.publishTime) : null;
        return (
          <div key={t} className="rounded-lg border border-line bg-panel px-3 py-2" data-testid={`price-${t}`}>
            <div className="text-xs text-gray-400">{t}</div>
            <div className="num text-lg">{p ? `$${p.price.toFixed(2)}` : '—'}</div>
            <div className="text-[11px] text-gray-500">{p ? (age! < 120 ? 'live' : `as of ${new Date(p.publishTime * 1000).toLocaleString()}`) : error ? 'oracle unavailable' : 'loading'}</div>
          </div>
        );
      })}
    </div>
  );
}
