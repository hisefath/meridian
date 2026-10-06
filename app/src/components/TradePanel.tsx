'use client';
import { useState } from 'react';
import { checkIntent, payoffText, walk, yesView, type Action, type OrderSlot, type TradeIntent } from '@meridian/sdk';

const ACTIONS: { id: Action; label: string; tone: 'yes' | 'no' }[] = [
  { id: 'buyYes', label: 'Buy YES', tone: 'yes' },
  { id: 'sellYes', label: 'Sell YES', tone: 'yes' },
  { id: 'buyNo', label: 'Buy NO', tone: 'no' },
  { id: 'sellNo', label: 'Sell NO', tone: 'no' },
];

/**
 * Best executable price for a market order of `qty`, in the traded token's cents.
 * Buying YES / selling NO takes YES asks; selling YES / buying NO hits YES bids.
 */
export function marketQuote(action: Action, orders: OrderSlot[], qty: number) {
  const v = yesView(orders);
  const takesAsks = action === 'buyYes' || action === 'sellNo';
  const w = walk(takesAsks ? v.asks : v.bids, qty);
  if (w.worst == null || w.filled < qty) return null;
  const isNo = action === 'buyNo' || action === 'sellNo';
  return { worst: isNo ? 100 - w.worst : w.worst, avg: isNo ? 100 - w.avg! : w.avg! };
}

export interface TradePanelProps {
  ticker: string;
  strikeUsd: number;
  orders: OrderSlot[] | null;
  holdings: { yes: number; no: number; usdc: number };
  connected: boolean;
  tradingOpen: boolean;
  onSubmit: (intent: TradeIntent) => Promise<unknown>;
}

export function TradePanel({ ticker, strikeUsd, orders, holdings, connected, tradingOpen, onSubmit }: TradePanelProps) {
  const [action, setAction] = useState<Action>('buyYes');
  const [kind, setKind] = useState<'market' | 'limit'>('market');
  const [qty, setQty] = useState(10);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);

  const quote = orders && kind === 'market' ? marketQuote(action, orders, qty) : null;
  const price = kind === 'limit' ? limit : quote?.worst ?? 0;
  const intent: TradeIntent = { action, qty, price, kind };
  const check = checkIntent(intent, holdings);
  const shownPrice = kind === 'market' ? quote?.avg ?? null : limit;
  const tone = ACTIONS.find((a) => a.id === action)!.tone;

  let blocker: string | null = null;
  if (!connected) blocker = 'Connect a wallet to trade';
  else if (!tradingOpen) blocker = 'Trading is closed for this contract';
  else if (kind === 'market' && !quote) blocker = 'Not enough liquidity for a market order. Try a limit order.';
  else if (!check.ok) blocker = check.reason;

  return (
    <section aria-label="Trade" className="rounded-lg border border-line bg-panel p-3">
      <div role="tablist" className="grid grid-cols-4 gap-1">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={action === a.id}
            onClick={() => setAction(a.id)}
            className={`rounded-md px-2 py-1.5 text-sm font-medium ${
              action === a.id ? (a.tone === 'yes' ? 'bg-yes text-black' : 'bg-no text-white') : 'bg-line text-gray-300 hover:bg-gray-700'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2 text-sm">
        {(['market', 'limit'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === 'market' ? 'Market' : 'Limit'}
          </label>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          Contracts
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value))))}
            className="num mt-1 w-full rounded-md border border-line bg-black/30 px-2 py-1.5 text-base text-white"
          />
        </label>
        <label className="text-xs text-gray-400">
          {kind === 'limit' ? `Limit price (${tone === 'yes' ? 'YES' : 'NO'}, ¢)` : 'Est. avg price'}
          {kind === 'limit' ? (
            <input
              type="number"
              min={1}
              max={99}
              value={limit}
              onChange={(e) => setLimit(Math.floor(Number(e.target.value)))}
              className="num mt-1 w-full rounded-md border border-line bg-black/30 px-2 py-1.5 text-base text-white"
            />
          ) : (
            <div className="num mt-1 rounded-md border border-line px-2 py-1.5 text-base">{shownPrice == null ? '—' : `${shownPrice.toFixed(1)}¢`}</div>
          )}
        </label>
      </div>

      {shownPrice != null && qty > 0 && (
        <p className="mt-3 text-sm text-gray-300" data-testid="payoff">
          {payoffText({ ...intent, price: Math.round(shownPrice) }, ticker, strikeUsd)}
          {kind === 'market' && <span className="block text-xs text-gray-500">Fill-or-kill, worst price {price}¢. Nothing executes if the book moves past it.</span>}
        </p>
      )}

      {blocker && (
        <p role="alert" className="mt-3 rounded-md bg-amber-500/10 px-2 py-1.5 text-sm text-amber-300">
          {blocker}
        </p>
      )}

      <button
        disabled={!!blocker || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit(intent);
          } finally {
            setBusy(false);
          }
        }}
        className={`mt-3 w-full rounded-md py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
          tone === 'yes' ? 'bg-yes text-black' : 'bg-no text-white'
        }`}
      >
        {busy ? 'Signing…' : `${ACTIONS.find((a) => a.id === action)!.label} ${qty}`}
      </button>
      <p className="mt-2 text-xs text-gray-500">
        Holdings: <span className="num">{holdings.yes}</span> YES · <span className="num">{holdings.no}</span> NO ·{' '}
        <span className="num">${holdings.usdc.toFixed(2)}</span> USDC
      </p>
    </section>
  );
}
