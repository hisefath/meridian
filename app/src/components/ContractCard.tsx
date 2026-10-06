'use client';
import { mid, yesView, type OrderSlot } from '@meridian/sdk';
import type { MarketRow } from '@/lib/meridian';

/** Strike row: YES bid/ask, implied probability (= YES mid) and the implied NO price. */
export function ContractCard({ m, orders, selected, onSelect }: { m: MarketRow; orders?: OrderSlot[] | null; selected: boolean; onSelect: () => void }) {
  const v = orders ? yesView(orders) : null;
  const p = v ? mid(v) : null;
  const settled = m.outcome !== 'open';
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border px-3 py-2 text-left ${selected ? 'border-blue-500 bg-blue-500/10' : 'border-line bg-panel hover:border-gray-600'}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">
          {m.ticker} ≥ <span className="num">${m.strikeUsd}</span>
        </span>
        {settled ? (
          <span className={`text-xs font-semibold ${m.outcome === 'yes' ? 'text-yes' : 'text-no'}`}>{m.outcome === 'yes' ? 'YES won' : 'NO won'}</span>
        ) : (
          <span className="num text-xs text-gray-400">{p == null ? 'no quotes' : `${Math.round(p)}% implied`}</span>
        )}
      </div>
      {!settled && v && (
        <div className="num mt-1 flex justify-between text-xs">
          <span className="text-yes">YES {v.bids[0]?.price ?? '–'} / {v.asks[0]?.price ?? '–'}¢</span>
          <span className="text-no">NO {v.asks[0] ? 100 - v.asks[0].price : '–'} / {v.bids[0] ? 100 - v.bids[0].price : '–'}¢</span>
        </div>
      )}
      {settled && <div className="num mt-1 text-xs text-gray-400">settled at ${m.settlePriceUsd.toFixed(2)}{m.byOverride ? ' (admin override)' : ' (Pyth)'}</div>}
    </button>
  );
}
