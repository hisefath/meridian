// Devnet-only faucet: 100 test USDC (+ a little SOL for fees) per wallet per 10 minutes.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { RPC_URL, USDC_MINT } from '@/lib/config';

const lastDrip = new Map<string, number>(); // ponytail: in-memory rate limit, resets on restart

function faucetKey(): Keypair | null {
  const v = process.env.FAUCET_KEYPAIR;
  if (!v) return null;
  if (v.trim().startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(v)));
  const file = [v, path.resolve(/*turbopackIgnore: true*/ process.cwd(), '..', v)].find(existsSync);
  return file ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')))) : null;
}

export async function POST(req: Request) {
  const rpc = RPC_URL;
  if (!rpc.includes('devnet') && !rpc.includes('127.0.0.1') && !rpc.includes('localhost'))
    return NextResponse.json({ error: 'faucet is devnet/localnet only' }, { status: 403 });
  const signer = faucetKey();
  if (!signer) return NextResponse.json({ error: 'FAUCET_KEYPAIR not configured' }, { status: 503 });

  let owner: PublicKey;
  try {
    owner = new PublicKey((await req.json()).address);
  } catch {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }
  const k = owner.toBase58();
  if (Date.now() - (lastDrip.get(k) ?? 0) < 10 * 60_000) return NextResponse.json({ error: 'one drip per 10 minutes' }, { status: 429 });

  const mint = USDC_MINT;
  const connection = new Connection(rpc, 'confirmed');
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, owner, mint),
    createMintToInstruction(mint, ata, signer.publicKey, 100_000_000),
  );
  if ((await connection.getBalance(owner)) < 0.01 * LAMPORTS_PER_SOL)
    tx.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: owner, lamports: 0.05 * LAMPORTS_PER_SOL }));
  try {
    const sig = await connection.sendTransaction(tx, [signer]);
    await connection.confirmTransaction(sig, 'confirmed');
    lastDrip.set(k, Date.now());
    return NextResponse.json({ signature: sig });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
