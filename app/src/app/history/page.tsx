'use client';
import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { marketEvents, touchedMarkets, type ParsedEvent } from '@meridian/sdk';
import { describeEvent } from '@/lib/history';
import { explorerTx, useBalances, useClient, useMarkets, type MarketRow } from '@/lib/meridian';

interface Line {
  e: ParsedEvent;
  m: MarketRow;
  what: string;
}

export default function History() {
  const { connection } = useConnection();
  const client = useClient();
  const { publicKey } = useWallet();
  const { markets } = useMarkets();
  const balances = useBalances(publicKey);
  const [lines, setLines] = useState<Line[] | null>(null);

  useEffect(() => {
    if (!publicKey || !markets) return;
    let live = true;
    (async () => {
      const me = publicKey.toBase58();
      const out: Line[] = [];
      // only markets this wallet has transacted in (from its own signatures)
      const touched = new Set((await touchedMarkets(connection, publicKey, markets.map((m) => m.pubkey))).map((k) => k.toBase58()));
      for (const m of markets.filter((x) => touched.has(x.pubkey.toBase58()))) {
        for (const e of await marketEvents(connection, client.program, m.pubkey, 200)) {
          const what = describeEvent(e, me);
          if (what) out.push({ e, m, what });
        }
      }
      out.sort((a, b) => (b.e.time ?? 0) - (a.e.time ?? 0));
      if (live) setLines(out);
    })().catch(() => live && setLines([]));
    return () => {
      live = false;
    };
  }, [publicKey?.toBase58(), markets?.length, balances.size, connection, client]);

  if (!publicKey) return <p className="text-gray-400">Connect a wallet to see your trade history.</p>;
  return (
    <div>
      <h1 className="text-2xl font-bold">History</h1>
      {!lines && <p className="mt-4 text-gray-400">Reading on-chain events…</p>}
      {lines && !lines.length && <p className="mt-4 text-gray-400">No activity yet.</p>}
      {lines && lines.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="py-1">Time</th>
              <th>Contract</th>
              <th>Action</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="num py-1.5 pr-3 text-gray-400">{l.e.time ? new Date(l.e.time * 1000).toLocaleString() : '—'}</td>
                <td className="pr-3">
                  {l.m.ticker} ≥ ${l.m.strikeUsd}
                </td>
                <td className="pr-3">{l.what}</td>
                <td>
                  <a className="text-blue-400 underline" href={explorerTx(l.e.signature)} target="_blank" rel="noreferrer">
                    view
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
