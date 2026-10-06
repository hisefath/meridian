'use client';
import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { UnsafeBurnerWalletAdapter } from '@solana/wallet-adapter-unsafe-burner';
import '@solana/wallet-adapter-react-ui/styles.css';

import { RPC_URL } from '@/lib/config';

// Wallet Standard wallets (Phantom, Solflare, Backpack…) register themselves; no adapter list needed.
// The in-browser burner wallet is for localnet demos/E2E only and must never be enabled on a real cluster.
const BURNER = process.env.NEXT_PUBLIC_ENABLE_BURNER === 'true';

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => (BURNER ? [new UnsafeBurnerWalletAdapter()] : []), []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
