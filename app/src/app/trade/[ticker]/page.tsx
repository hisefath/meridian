'use client';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { claimableOf, intentInstructions, mid, ordersOf, TICKERS, yesView, type Ticker } from '@meridian/sdk';
import { ContractCard } from '@/components/ContractCard';
import { Countdown } from '@/components/Countdown';
import { OrderBook } from '@/components/OrderBook';
import { TradePanel } from '@/components/TradePanel';
import { TxStatus } from '@/components/TxStatus';
import { USDC_MINT, useBalances, useBook, useBooks, useClient, useConfig, useMarkets, usePrices, useRefresh, useSend } from '@/lib/meridian';

const LABEL = { buyYes: 'Buy YES', sellYes: 'Sell YES', buyNo: 'Buy NO', sellNo: 'Sell NO' } as const;

export default function Trade() {
  const ticker = useParams<{ ticker: string }>().ticker.toUpperCase() as Ticker;
  const client = useClient();
  const cfg = useConfig();
  const { publicKey } = useWallet();
  const [refresh, bump] = useRefresh();
  const { markets } = useMarkets(refresh);
  const { prices } = usePrices();
  const balances = useBalances(publicKey, refresh);
  const { send, status } = useSend(bump);
  const [selected, setSelected] = useState<string | null>(null);
  const [mintQty, setMintQty] = useState(10);

  // latest session's contracts for this stock
  const list = useMemo(() => {
    const mine = (markets ?? []).filter((m) => m.ticker === ticker);
    const latest = Math.max(0, ...mine.map((m) => m.closeTs));
    return mine.filter((m) => m.closeTs === latest || m.outcome === 'open').sort((a, b) => a.strikeUsd - b.strikeUsd);
  }, [markets, ticker]);
  const books = useBooks(useMemo(() => list.map((m) => m.pubkey), [list]));
  // start on the most contested strike (implied probability closest to 50%)
  useEffect(() => {
    if (selected || !list.length || !books.size) return;
    const score = (k: string) => Math.abs((mid(yesView(books.get(k) ?? [])) ?? 0) - 50);
    setSelected(list.map((m) => m.pubkey.toBase58()).sort((a, b) => score(a) - score(b))[0]);
  }, [list, books, selected]);
  const market = list.find((m) => m.pubkey.toBase58() === selected);
  const orders = useBook(market?.pubkey);

  if (!TICKERS.includes(ticker)) return <p>Unknown ticker {ticker}</p>;
  const acc = market ? client.accounts(market.pubkey) : null;
  const holdings = {
    yes: acc ? balances.get(acc.yesMint.toBase58()) ?? 0 : 0,
    no: acc ? balances.get(acc.noMint.toBase58()) ?? 0 : 0,
    usdc: (balances.get(USDC_MINT.toBase58()) ?? 0) / 1e6,
  };
  const now = Math.floor(Date.now() / 1000);
  const haltTs = market ? market.closeTs - (cfg?.maxStalenessSecs ?? 0) : 0;
  const tradingOpen = !!market && market.outcome === 'open' && now < haltTs && !cfg?.paused;
  const myOrders = orders && publicKey ? ordersOf(orders, publicKey) : [];
  const claim = orders && publicKey ? claimableOf(orders, publicKey) : { yes: 0, usdc: 0 };
  const p = prices[ticker];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold">{ticker}</h1>
        <span className="num text-xl">{p ? `$${p.price.toFixed(2)}` : '—'}</span>
        <span className="text-xs text-gray-500">Pyth oracle</span>
        {market && (
          <span className="ml-auto text-sm text-gray-300">
            <Countdown closeTs={market.closeTs} outcome={market.outcome} haltTs={haltTs} />
          </span>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr_340px]">
        <aside aria-label="Strikes" className="space-y-2">
          {!markets && <p className="text-sm text-gray-400">Loading contracts…</p>}
          {markets && !list.length && <p className="text-sm text-gray-400">No contracts for {ticker} yet. The morning job creates them before the open.</p>}
          {list.map((m) => (
            <ContractCard key={m.pubkey.toBase58()} m={m} orders={m.pubkey.toBase58() === selected ? orders : books.get(m.pubkey.toBase58())} selected={m.pubkey.toBase58() === selected} onSelect={() => setSelected(m.pubkey.toBase58())} />
          ))}
        </aside>

        <div className="min-w-0 space-y-4">
          {market && (
            <p className="text-sm text-gray-300">
              <b>YES</b> pays $1 if {ticker} closes at or above <b className="num">${market.strikeUsd}</b>. <b>NO</b> pays $1 if it closes below.
            </p>
          )}
          <OrderBook orders={market ? orders : []} />
          {publicKey && market && (myOrders.length > 0 || claim.yes + claim.usdc > 0) && (
            <section aria-label="Your orders" className="rounded-lg border border-line bg-panel p-3 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Your orders</h3>
                {claim.yes + claim.usdc > 0 && (
                  <button
                    className="rounded-md bg-blue-600 px-2 py-1 text-xs"
                    onClick={async () => {
                      const ixs = [...client.ensureTokenAccounts(publicKey, publicKey, market.pubkey), await client.claimFills(publicKey, market.pubkey)];
                      // a filled "Sell NO" limit leaves YES+NO: merge the pairs for $1 each in the same tx
                      const pairs = Math.min(holdings.yes + claim.yes, holdings.no);
                      if (pairs > 0) ixs.push(await client.redeemPair(publicKey, market.pubkey, pairs));
                      await send(ixs, 'Claim fills');
                    }}
                  >
                    Claim {claim.yes > 0 && `${claim.yes} YES`} {claim.usdc > 0 && `$${(claim.usdc / 1e6).toFixed(2)}`}
                  </button>
                )}
              </div>
              <ul className="mt-2 divide-y divide-line">
                {myOrders
                  .filter((o) => o.qty > 0)
                  .map((o) => (
                    <li key={o.seq} className="num flex items-center justify-between py-1">
                      <span className={o.side === 'bid' ? 'text-yes' : 'text-no'}>
                        {o.side === 'bid' ? 'Bid' : 'Ask'} YES {o.qty} @ {o.price}¢
                      </span>
                      <button className="text-xs text-gray-400 underline" onClick={async () => send([await client.cancelOrder(publicKey, market.pubkey, o.seq)], 'Cancel order')}>
                        cancel
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-3">
          {market && (
            <TradePanel
              ticker={ticker}
              strikeUsd={market.strikeUsd}
              orders={orders}
              holdings={holdings}
              connected={!!publicKey}
              tradingOpen={tradingOpen}
              onSubmit={async (intent) => send(await intentInstructions(client, publicKey!, market.pubkey, intent, orders ?? undefined), LABEL[intent.action])}
            />
          )}
          {market && publicKey && market.outcome === 'open' && now < market.closeTs && (
            <section aria-label="Market maker" className="rounded-lg border border-line bg-panel p-3 text-sm">
              <h3 className="font-semibold">Mint pairs (market makers)</h3>
              <p className="mt-1 text-xs text-gray-400">Deposit $1 USDC per pair and receive 1 YES + 1 NO. Then quote YES with limit orders.</p>
              <div className="mt-2 flex gap-2">
                <input aria-label="Pairs to mint" type="number" min={1} value={mintQty} onChange={(e) => setMintQty(Math.floor(Number(e.target.value)))} className="num w-24 rounded-md border border-line bg-black/30 px-2 py-1" />
                <button
                  className="rounded-md bg-line px-3 py-1 hover:bg-gray-700"
                  onClick={async () => send([...client.ensureTokenAccounts(publicKey, publicKey, market.pubkey), await client.mintPair(publicKey, market.pubkey, mintQty)], 'Mint pairs')}
                >
                  Mint ${mintQty}
                </button>
                {Math.min(holdings.yes, holdings.no) > 0 && (
                  <button className="rounded-md bg-line px-3 py-1 hover:bg-gray-700" onClick={async () => send([await client.redeemPair(publicKey, market.pubkey, Math.min(holdings.yes, holdings.no))], 'Merge pairs')}>
                    Merge {Math.min(holdings.yes, holdings.no)} pairs → ${Math.min(holdings.yes, holdings.no)}
                  </button>
                )}
              </div>
            </section>
          )}
          <TxStatus status={status} />
        </div>
      </div>
    </div>
  );
}
