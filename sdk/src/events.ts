import { EventParser } from '@coral-xyz/anchor';
import type { Connection, PublicKey } from '@solana/web3.js';
import type { MeridianProgram } from './client';

export interface ParsedEvent {
  name: string;
  data: Record<string, any>;
  signature: string;
  slot: number;
  time: number | null;
}

/** Decode Meridian events from raw program logs. */
export function parseLogs(program: MeridianProgram, logs: string[]) {
  const parser = new EventParser(program.programId, program.coder);
  return [...parser.parseLogs(logs)];
}

/**
 * Every event touching a market, oldest first. The market account is in every
 * mint/trade/settle/redeem transaction, so its signature list is the market's history.
 * ponytail: client-side scan of recent signatures; add an indexer if history grows past a few hundred txs.
 */
export async function marketEvents(connection: Connection, program: MeridianProgram, market: PublicKey, limit = 300) {
  const sigs = await connection.getSignaturesForAddress(market, { limit });
  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  );
  const out: ParsedEvent[] = [];
  txs.forEach((tx, i) => {
    if (!tx?.meta?.logMessages || tx.meta.err) return;
    for (const e of parseLogs(program, tx.meta.logMessages)) {
      out.push({ name: e.name, data: e.data as Record<string, any>, signature: sigs[i].signature, slot: tx.slot, time: tx.blockTime ?? null });
    }
  });
  return out.reverse();
}

/**
 * Markets a wallet has touched, read from the wallet's own recent transactions (every
 * mint, order, cancel, claim and redeem is signed by the user, so maker positions show up too).
 */
export async function touchedMarkets(connection: Connection, owner: PublicKey, markets: PublicKey[], limit = 300) {
  const known = new Map(markets.map((m) => [m.toBase58(), m]));
  const sigs = await connection.getSignaturesForAddress(owner, { limit });
  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  );
  const hit = new Set<string>();
  for (const tx of txs) {
    for (const k of tx?.transaction.message.staticAccountKeys ?? []) if (known.has(k.toBase58())) hit.add(k.toBase58());
  }
  return [...hit].map((k) => known.get(k)!);
}
