'use client';
import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { applyEvents, claimableOf, fillsToTrades, marketEvents, mid, yesView, type OrderSlot, type Position } from '@meridian/sdk';
import { PositionRow } from '@/components/PositionRow';
import { TxStatus } from '@/components/TxStatus';
import { useBalances, useClient, useMarkets, useRefresh, useSend, type MarketRow } from '@/lib/meridian';

interface Row {
  m: MarketRow;
  yes: number;
  no: number;
  orders: OrderSlot[];
  pos: Position;
}

export default function Portfolio() {
  const { connection } = useConnection();
  const client = useClient();
  const { publicKey } = useWallet();
  const [refresh, bump] = useRefresh();
  const { markets } = useMarkets(refresh);
  const balances = useBalances(publicKey, refresh);
  const { send, status } = useSend(bump);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!publicKey || !markets) return;
    let live = true;
    (async () => {
      // books of every market in one RPC round trip, to find resting orders and unclaimed fills
      const books = await connection.getMultipleAccountsInfo(markets.map((m) => client.accounts(m.pubkey).book));
      const out: Row[] = [];
      for (const [i, m] of markets.entries()) {
        const a = client.accounts(m.pubkey);
        const yes = balances.get(a.yesMint.toBase58()) ?? 0;
        const no = balances.get(a.noMint.toBase58()) ?? 0;
        const orders = (books[i] ? client.decodeBook(books[i]!.data).orders : []) as OrderSlot[];
        const mine = orders.some((o) => o.owner.equals(publicKey) && (Number(o.qty) > 0 || Number(o.claimable) > 0));
        if (yes + no === 0 && !mine) continue;
        const events = await marketEvents(connection, client.program, m.pubkey);
        const fills = events.filter((e) => e.name === 'fill').map((e) => e.data as any);
        out.push({ m, yes, no, orders, pos: applyEvents(fillsToTrades(fills, publicKey)) });
      }
      if (live) setRows(out);
    })().catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [publicKey?.toBase58(), markets, balances, connection, client]);

  if (!publicKey) return <p className="text-gray-400">Connect a wallet to see your positions.</p>;
  const open = rows?.filter((r) => r.m.outcome === 'open') ?? [];
  const settled = rows?.filter((r) => r.m.outcome !== 'open') ?? [];
  const realized = (rows ?? []).reduce((s, r) => s + r.pos.realized, 0);

  const table = (list: Row[]) => (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-gray-500">
        <tr>
          <th className="py-1">Contract</th>
          <th>Holding</th>
          <th>Entry</th>
          <th>Mark</th>
          <th>Unrealized</th>
          <th>Realized</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((r) => {
          const pk = r.m.pubkey;
          return (
            <PositionRow
              key={pk.toBase58()}
              m={r.m}
              yes={r.yes}
              no={r.no}
              pos={r.pos}
              markYes={mid(yesView(r.orders))}
              claim={claimableOf(r.orders, publicKey)}
              onRedeem={async () => send([await client.redeem(publicKey, pk)], 'Redeem')}
              onMerge={async () => send([await client.redeemPair(publicKey, pk, Math.min(r.yes, r.no))], 'Close pairs')}
              onClaim={async () => {
                const ixs = [...client.ensureTokenAccounts(publicKey, publicKey, pk), await client.claimFills(publicKey, pk)];
                // after settlement, resting orders are dead weight: cancel them in the same tx
                if (r.m.outcome !== 'open')
                  for (const o of r.orders.filter((o) => o.owner.equals(publicKey) && Number(o.qty) > 0)) ixs.push(await client.cancelOrder(publicKey, pk, o.seq as any));
                await send(ixs, 'Claim fills');
              }}
            />
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Portfolio</h1>
        <span className="text-sm text-gray-400">
          Realized P&L <span className={`num ${realized >= 0 ? 'text-yes' : 'text-no'}`}>{(realized / 100).toFixed(2)} USD</span>
        </span>
      </div>
      <TxStatus status={status} />
      {!rows && <p className="text-gray-400">Loading positions…</p>}
      {rows && (
        <>
          <section className="rounded-lg border border-line bg-panel p-3">
            <h2 className="mb-2 font-semibold">Active positions</h2>
            {open.length ? table(open) : <p className="text-sm text-gray-500">No open positions.</p>}
          </section>
          <section className="rounded-lg border border-line bg-panel p-3">
            <h2 className="mb-2 font-semibold">Settled</h2>
            {settled.length ? table(settled) : <p className="text-sm text-gray-500">Nothing settled yet. Unredeemed winners stay redeemable forever.</p>}
          </section>
        </>
      )}
    </div>
  );
}
