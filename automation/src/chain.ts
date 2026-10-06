// Shared env + chain plumbing for the automation service and the devnet scripts.
import { readFileSync } from 'node:fs';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { MeridianClient, createProgram } from '@meridian/sdk';

export const env = (k: string, d?: string) => {
  const v = process.env[k] || d;
  if (v === undefined) throw new Error(`missing env ${k} (see .env.example)`);
  return v;
};

export function loadKeypair(value: string) {
  const raw = value.trim().startsWith('[') ? value : readFileSync(value, 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export const connection = new Connection(env('RPC_URL', 'https://api.devnet.solana.com'), 'confirmed');
export const admin = loadKeypair(env('ADMIN_KEYPAIR', 'keys/admin.json'));
export const usdcMint = new PublicKey(env('USDC_MINT'));
export const client = new MeridianClient(createProgram(connection), usdcMint);

export async function send(ixs: TransactionInstruction[], signers: Keypair[] = [admin], cu = 400_000) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  const sig = await connection.sendTransaction(tx);
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) {
    const logs = (await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 }))?.meta?.logMessages ?? [];
    throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}\n${logs.join('\n')}`);
  }
  return sig;
}

export const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${connection.rpcEndpoint.includes('devnet') ? 'devnet' : 'custom'}`;
