'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { USDC_MINT, useBalances, useRefresh } from '@/lib/meridian';

const LINKS = [
  ['/markets', 'Markets'],
  ['/portfolio', 'Portfolio'],
  ['/history', 'History'],
] as const;

export function Nav() {
  const path = usePathname();
  const { publicKey } = useWallet();
  const [refresh, bump] = useRefresh();
  const balances = useBalances(publicKey, refresh);
  const [faucet, setFaucet] = useState<string | null>(null);
  const usdc = (balances.get(USDC_MINT.toBase58()) ?? 0) / 1e6;

  async function drip() {
    setFaucet('requesting…');
    const r = await fetch('/api/faucet', { method: 'POST', body: JSON.stringify({ address: publicKey!.toBase58() }) });
    const body = await r.json();
    setFaucet(r.ok ? '+100 test USDC' : body.error);
    if (r.ok) bump();
  }

  return (
    <nav className="sticky top-0 z-10 border-b border-line bg-[#0b0f17]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
        <Link href="/" className="font-bold tracking-tight">
          Meridian<span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] font-medium text-amber-300">DEVNET</span>
        </Link>
        <div className="flex gap-3 text-sm">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path.startsWith(href) ? 'text-white' : 'text-gray-400 hover:text-white'}>
              {label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {publicKey && (
            <>
              <span className="num text-gray-300" aria-label="USDC balance">
                ${usdc.toFixed(2)}
              </span>
              <button onClick={drip} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-line">
                Get test USDC
              </button>
              {faucet && <span className="text-xs text-gray-400" role="status">{faucet}</span>}
            </>
          )}
          <WalletMultiButton />
        </div>
      </div>
    </nav>
  );
}
