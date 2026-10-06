'use client';
import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PriceStrip } from '@/components/PriceStrip';
import { usePrices } from '@/lib/meridian';

const STEPS = [
  ['Pick a question', 'Every trading morning, each MAG7 stock gets strikes at ±3/6/9% from yesterday’s close: “Will META close at or above $680 today?”'],
  ['Buy YES or NO', 'Price = probability. YES at 62¢ means the market thinks 62%. NO is the other 38¢. Max loss is what you pay, max win is $1.'],
  ['Settle at 4:00 PM ET', 'The Pyth oracle closing price settles every contract on-chain within minutes. Winners redeem $1 USDC per token.'],
];

export default function Landing() {
  const { prices, error } = usePrices();
  return (
    <div className="space-y-10">
      <section className="pt-6">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Will NVDA close above $190 today? <span className="text-yes">Trade the answer.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-gray-300">
          Meridian lists same-day binary contracts on the seven largest US tech stocks. Each pays exactly <b>$1.00 USDC</b> if it’s right and
          <b> $0</b> if it’s wrong. You hold the collateral yourself, and settlement happens on-chain.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/markets" className="rounded-md bg-yes px-4 py-2 font-semibold text-black">
            Browse markets
          </Link>
          <WalletMultiButton />
        </div>
      </section>
      <section aria-label="Live prices">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">Live oracle prices</h2>
        <PriceStrip prices={prices} error={error} />
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <div key={title} className="rounded-lg border border-line bg-panel p-4">
            <div className="text-xs text-gray-500">Step {i + 1}</div>
            <h3 className="mt-1 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-gray-300">{body}</p>
          </div>
        ))}
      </section>
      <section className="rounded-lg border border-line bg-panel p-4 text-sm text-gray-300">
        <b>YES + NO = $1, always.</b> Every pair is minted by depositing exactly $1 USDC into a program-owned vault, so every winning token is fully
        backed. There is one order book per strike (YES vs USDC). Buying NO mints a pair and sells the YES in the same transaction.
      </section>
    </div>
  );
}
