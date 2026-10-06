'use client';
import { noView, yesView, type BookView, type Level, type OrderSlot } from '@meridian/sdk';

function Side({ levels, kind, max }: { levels: Level[]; kind: 'bid' | 'ask'; max: number }) {
  const color = kind === 'bid' ? 'bg-yes/20' : 'bg-no/20';
  const text = kind === 'bid' ? 'text-yes' : 'text-no';
  if (!levels.length) return <div className="px-2 py-1 text-xs text-gray-500">no {kind}s</div>;
  return (
    <ul>
      {levels.slice(0, 8).map((l) => (
        <li key={l.price} className="relative flex justify-between px-2 py-0.5 text-sm" data-testid={`${kind}-level`}>
          <span className={`absolute inset-y-0 right-0 ${color}`} style={{ width: `${(l.qty / max) * 100}%` }} aria-hidden />
          <span className={`num relative ${text}`}>{l.price}¢</span>
          <span className="num relative text-gray-300">{l.qty}</span>
        </li>
      ))}
    </ul>
  );
}

function BookColumn({ title, view, hint }: { title: string; view: BookView; hint: string }) {
  const max = Math.max(1, ...view.bids.map((l) => l.qty), ...view.asks.map((l) => l.qty));
  const spread = view.asks[0] && view.bids[0] ? view.asks[0].price - view.bids[0].price : null;
  return (
    <section aria-label={title} className="min-w-0 flex-1 rounded-lg border border-line bg-panel">
      <header className="flex items-baseline justify-between border-b border-line px-2 py-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-gray-500">{hint}</span>
      </header>
      <div className="flex justify-between px-2 pt-1 text-[11px] uppercase text-gray-500">
        <span>Price</span>
        <span>Qty</span>
      </div>
      <Side levels={[...view.asks].reverse()} kind="ask" max={max} />
      <div className="border-y border-line px-2 py-0.5 text-center text-xs text-gray-400">
        {spread == null ? 'one-sided book' : `spread ${spread}¢`}
      </div>
      <Side levels={view.bids} kind="bid" max={max} />
    </section>
  );
}

/** One on-chain book, two perspectives: NO prices are 100¢ − YES prices with bids/asks swapped. */
export function OrderBook({ orders }: { orders: OrderSlot[] | null }) {
  if (!orders) return <div className="rounded-lg border border-line bg-panel p-4 text-sm text-gray-400">Loading order book…</div>;
  const yes = yesView(orders);
  return (
    <div className="flex gap-3">
      <BookColumn title="YES book" view={yes} hint="on-chain" />
      <BookColumn title="NO view" view={noView(yes)} hint="same book, 100¢ − YES" />
    </div>
  );
}
