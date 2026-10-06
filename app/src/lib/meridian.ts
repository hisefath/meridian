'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { MICRO, MeridianClient, TICKERS, createProgram, outcomeOf, type OrderSlot, type Ticker } from '@meridian/sdk';

import { USDC_MINT } from './config';
export { USDC_MINT };

export interface MarketRow {
  pubkey: PublicKey;
  ticker: Ticker;
  strikeUsd: number;
  closeTs: number;
  outcome: 'open' | 'yes' | 'no';
  settlePriceUsd: number;
  byOverride: boolean;
  collateralUsd: number;
}

export function useClient() {
  const { connection } = useConnection();
  return useMemo(() => new MeridianClient(createProgram(connection), USDC_MINT), [connection]);
}

/** Protocol config (oracle window drives the pre-close trading halt; pause flag). */
export function useConfig() {
  const client = useClient();
  const [cfg, setCfg] = useState<{ maxStalenessSecs: number; overrideDelaySecs: number; paused: boolean } | null>(null);
  useEffect(() => {
    client
      .fetchConfig()
      .then((c) => setCfg({ maxStalenessSecs: c.maxStalenessSecs, overrideDelaySecs: c.overrideDelaySecs, paused: c.paused }))
      .catch(() => {});
  }, [client]);
  return cfg;
}

/** Bump to make hooks refetch right after a transaction lands. */
export function useRefresh() {
  const [n, setN] = useState(0);
  return [n, useCallback(() => setN((x) => x + 1), [])] as const;
}

export function useMarkets(refresh = 0) {
  const client = useClient();
  const [markets, setMarkets] = useState<MarketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      client
        .fetchMarkets()
        .then((rows) => {
          if (!live) return;
          setError(null);
          setMarkets(
            rows
              .map(({ publicKey, account: m }) => ({
                pubkey: publicKey,
                ticker: TICKERS[m.ticker],
                strikeUsd: Number(m.strike) / MICRO,
                closeTs: Number(m.closeTs),
                outcome: outcomeOf(m),
                settlePriceUsd: Number(m.settlePrice) / MICRO,
                byOverride: m.settledByOverride,
                collateralUsd: Number(m.collateral) / MICRO,
              }))
              .sort((a, b) => b.closeTs - a.closeTs || a.strikeUsd - b.strikeUsd),
          );
        })
        .catch((e) => live && setError(String(e?.message ?? e)));
    load();
    const id = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [client, refresh]);
  return { markets, error };
}

/** The order book, live: one fetch, then a WebSocket subscription on the book account. */
export function useBook(market?: PublicKey) {
  const client = useClient();
  const { connection } = useConnection();
  const [orders, setOrders] = useState<OrderSlot[] | null>(null);
  useEffect(() => {
    if (!market) return;
    setOrders(null);
    const book = client.accounts(market).book;
    const apply = (data: Buffer) => setOrders(client.decodeBook(data).orders as OrderSlot[]);
    connection.getAccountInfo(book).then((a) => a && apply(a.data));
    const sub = connection.onAccountChange(book, (a) => apply(a.data), 'confirmed');
    return () => void connection.removeAccountChangeListener(sub);
  }, [client, connection, market?.toBase58()]);
  return orders;
}

/** Every listed market's book in one RPC round trip, refreshed every few seconds (strike cards). */
export function useBooks(markets: PublicKey[], intervalMs = 5_000) {
  const client = useClient();
  const { connection } = useConnection();
  const [books, setBooks] = useState<Map<string, OrderSlot[]>>(new Map());
  const key = markets.map((m) => m.toBase58()).join(',');
  useEffect(() => {
    if (!markets.length) return;
    let live = true;
    const load = () =>
      connection.getMultipleAccountsInfo(markets.map((m) => client.accounts(m).book)).then((infos) => {
        if (!live) return;
        const next = new Map<string, OrderSlot[]>();
        infos.forEach((a, i) => a && next.set(markets[i].toBase58(), client.decodeBook(a.data).orders as OrderSlot[]));
        setBooks(next);
      });
    load().catch(() => {});
    const id = setInterval(() => load().catch(() => {}), intervalMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [client, connection, key, intervalMs]);
  return books;
}

/** mint → whole-unit balance for every SPL token account the wallet owns. */
export function useBalances(owner: PublicKey | null, refresh = 0) {
  const { connection } = useConnection();
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!owner) return setBalances(new Map());
    let live = true;
    const load = () =>
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }).then((r) => {
        if (!live) return;
        const m = new Map<string, number>();
        for (const { account } of r.value) {
          const info = account.data.parsed.info;
          m.set(info.mint, (m.get(info.mint) ?? 0) + Number(info.tokenAmount.amount));
        }
        setBalances(m);
      });
    load().catch(() => {});
    const id = setInterval(() => load().catch(() => {}), 10_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connection, owner?.toBase58(), refresh]);
  return balances;
}

export interface OraclePrice {
  price: number;
  conf: number;
  publishTime: number;
}

/** Live Pyth prices via the server-side Hermes proxy (keeps the API key off the client). */
export function usePrices(intervalMs = 5_000) {
  const [prices, setPrices] = useState<Partial<Record<Ticker, OraclePrice>>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/prices')
        .then(async (r) => {
          const body = await r.json();
          if (!live) return;
          if (!r.ok) throw new Error(body.error ?? r.statusText);
          setPrices(body.prices);
          setError(null);
        })
        .catch((e) => live && setError(String(e.message ?? e)));
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return { prices, error };
}

/** Sign + send one transaction (all instructions atomic, one wallet prompt). */
export function useSend(onDone?: () => void) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<{ kind: 'idle' | 'pending' | 'ok' | 'error'; msg?: string; sig?: string }>({ kind: 'idle' });
  const send = useCallback(
    async (ixs: TransactionInstruction[], label: string) => {
      if (!publicKey) throw new Error('Connect a wallet first');
      setStatus({ kind: 'pending', msg: `${label}: waiting for signature…` });
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const tx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: blockhash,
            instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs],
          }).compileToV0Message(),
        );
        const sig = await sendTransaction(tx, connection);
        setStatus({ kind: 'pending', msg: `${label}: confirming…`, sig });
        const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
        setStatus({ kind: 'ok', msg: `${label}: confirmed`, sig });
        onDone?.();
        return sig;
      } catch (e: any) {
        setStatus({ kind: 'error', msg: `${label}: ${programError(e)}` });
        throw e;
      }
    },
    [connection, publicKey, sendTransaction, onDone],
  );
  return { send, status };
}

/** Pull the Anchor error message out of simulation logs when there is one. */
function programError(e: any): string {
  const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
  const hit = logs.find((l) => l.includes('Error Message:'));
  return hit ? hit.split('Error Message:')[1].trim() : String(e?.message ?? e);
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const usd = (n: number, digits = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
