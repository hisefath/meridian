import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meridian · Binary stock outcomes on Solana',
  description: 'Trade YES/NO contracts on where MAG7 stocks close today. $1 if right, $0 if wrong.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-gray-500">
            Devnet demo with test funds only. Not an offer of securities or financial advice. Prices from Pyth.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
