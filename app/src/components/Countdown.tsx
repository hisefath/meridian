'use client';
import { useEffect, useState } from 'react';

export function remaining(closeTs: number, now: number) {
  const s = Math.max(0, closeTs - now);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

const et = (ts: number) => new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

/**
 * Live countdown. Orders stop at `haltTs` (close minus the oracle window, so nobody trades on a
 * published settlement print); the market closes and settles at `closeTs` (4:00 PM ET, or 1:00 PM on half days).
 */
export function Countdown({ closeTs, outcome, haltTs }: { closeTs: number; outcome: 'open' | 'yes' | 'no'; haltTs?: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  if (outcome !== 'open') return <span className="text-gray-400">Settled</span>;
  if (now >= closeTs) return <span className="text-amber-400">Closed · awaiting settlement</span>;
  if (haltTs && now >= haltTs) return <span className="text-amber-400">Trading halted · settles at the {et(closeTs)} ET close</span>;
  const target = haltTs ?? closeTs;
  return (
    <span>
      {haltTs ? 'Trading closes' : 'Closes'} {et(target)} ET · <span className="num">{remaining(target, now)}</span>
    </span>
  );
}
