// Cluster config shared by client components and server routes (no 'use client' here).
import { PublicKey } from '@solana/web3.js';

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';
export const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? 'Hfc3dPjuECg2n6qk3b8C4G2J2GeMnxKM7KAJ4zzCV4Qg');
