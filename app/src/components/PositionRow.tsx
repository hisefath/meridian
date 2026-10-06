'use client';
import { describe as describePos, type Position } from '@meridian/sdk';
import type { MarketRow } from '@/lib/meridian';

export interface PositionRowProps {
  m: MarketRow;
  yes: number;
  no: number;
  pos: Position | null;
  markYes: number | null;
  claim: { yes: number; usdc: number };
  onRedeem: () => void;
  onClaim: () => void;
  onMerge: () => void;
}

const cents = (c: number) => `${c >= 0 ? '+' : '−'}$${Math.abs(c / 100).toFixed(2)}`;

/** One market in the portfolio: live position with P&L, or settled outcome with redeem. */
export function PositionRow({ m, yes, no, pos, markYes, claim, onRedeem, onClaim, onMerge }: PositionRowProps) {
  const settled = m.outcome !== 'open';
  const view = pos ? describePos(pos, settled ? (m.outcome === 'yes' ? 100 : 0) : markYes) : null;
  const payout = settled ? (m.outcome === 'yes' ? yes : no) : 0;
  const pairs = Math.min(yes, no);
  return (
    <tr className="border-t border-line align-top" data-testid="position-row">
      <td className="py-2 pr-3">
        <div className="font-semibold">
          {m.ticker} ≥ <span className="num">${m.strikeUsd}</span>
        </div>
        <div className="text-xs text-gray-500">{new Date(m.closeTs * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}</div>
      </td>
      <td className="num py-2 pr-3">
        {yes > 0 && <div className="text-yes">{yes} YES</div>}
        {no > 0 && <div className="text-no">{no} NO</div>}
        {yes + no === 0 && <span className="text-gray-500">—</span>}
      </td>
      <td className="num py-2 pr-3">{view ? `${view.entry.toFixed(1)}¢` : '—'}</td>
      <td className="num py-2 pr-3">{view?.mark == null ? '—' : `${view.mark.toFixed(1)}¢`}</td>
      <td className="num py-2 pr-3" data-testid="unrealized">
        {view?.unrealized == null ? '—' : <span className={view.unrealized >= 0 ? 'text-yes' : 'text-no'}>{cents(view.unrealized)}</span>}
      </td>
      <td className="num py-2 pr-3" data-testid="realized">
        {pos ? <span className={pos.realized >= 0 ? 'text-yes' : 'text-no'}>{cents(pos.realized)}</span> : '—'}
      </td>
      <td className="py-2 text-right">
        {settled ? (
          <div className="space-y-1">
            <div className={`text-sm font-semibold ${m.outcome === 'yes' ? 'text-yes' : 'text-no'}`}>
              {m.outcome === 'yes' ? 'YES' : 'NO'} won at ${m.settlePriceUsd.toFixed(2)}
            </div>
            {yes + no > 0 && (
              <button onClick={onRedeem} className="rounded-md bg-yes px-3 py-1 text-sm font-semibold text-black">
                Redeem ${payout.toFixed(2)}
              </button>
            )}
          </div>
        ) : (
          pairs > 0 && (
            <button onClick={onMerge} className="rounded-md bg-line px-3 py-1 text-sm">
              Close {pairs} pair{pairs > 1 ? 's' : ''} → ${pairs}
            </button>
          )
        )}
        {claim.yes + claim.usdc > 0 && (
          <button onClick={onClaim} className="mt-1 block w-full rounded-md bg-blue-600 px-3 py-1 text-sm">
            Claim fills
          </button>
        )}
      </td>
    </tr>
  );
}
