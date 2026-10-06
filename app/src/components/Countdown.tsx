'use client';
import { useEffect, useState } from 'react';

export function remaining(closeTs: number, now: number) {
  const s = Math.max(0, closeTs - now);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

/** Live countdown to the market close (4:00 PM ET, or the early close on half days). */
export function Countdown({ closeTs, outcome }: { closeTs: number; outcome: 'open' | 'yes' | 'no' }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  if (outcome !== 'open') return <span className="text-gray-400">Settled</span>;
  if (now >= closeTs) return <span className="text-amber-400">Closed · awaiting settlement</span>;
  const closeEt = new Date(closeTs * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return (
    <span>
      Closes {closeEt} ET · <span className="num">{remaining(closeTs, now)}</span>
    </span>
  );
}
