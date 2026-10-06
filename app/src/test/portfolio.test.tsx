import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { applyEvents } from '@meridian/sdk';
import { PositionRow } from '@/components/PositionRow';
import { market } from './fixtures';

const noop = { onRedeem: vi.fn(), onClaim: vi.fn(), onMerge: vi.fn(), claim: { yes: 0, usdc: 0 } };
const row = (props: Parameters<typeof PositionRow>[0]) => (
  <table>
    <tbody>
      <PositionRow {...props} />
    </tbody>
  </table>
);

describe('portfolio P&L', () => {
  it('long YES: entry, mark and unrealized P&L', () => {
    const pos = applyEvents([
      { kind: 'trade', side: 'buy', price: 60, qty: 10 },
      { kind: 'trade', side: 'buy', price: 66, qty: 5 },
    ]);
    render(row({ ...noop, m: market(), yes: 15, no: 0, pos, markYes: 70 }));
    expect(screen.getByText('62.0¢')).toBeInTheDocument(); // (600 + 330) / 15
    expect(screen.getByTestId('unrealized')).toHaveTextContent('+$1.20'); // 15 × 8¢
  });

  it('NO bought via mint+sell shows NO entry 100 − YES sale price; realized after partial exit', () => {
    const pos = applyEvents([
      { kind: 'trade', side: 'sell', price: 58, qty: 10 }, // Buy NO @ 42
      { kind: 'trade', side: 'buy', price: 50, qty: 4 }, // Sell NO 4 @ 50
    ]);
    render(row({ ...noop, m: market(), yes: 0, no: 6, pos, markYes: 50 }));
    expect(screen.getByText('42.0¢')).toBeInTheDocument();
    expect(screen.getByTestId('realized')).toHaveTextContent('+$0.32'); // 4 × 8¢
    expect(screen.getByTestId('unrealized')).toHaveTextContent('+$0.48'); // 6 × 8¢
  });
});

describe('settlement display and redeem', () => {
  it('shows the outcome, settle price and the exact payout, and redeems on click', async () => {
    const onRedeem = vi.fn();
    const pos = applyEvents([{ kind: 'trade', side: 'buy', price: 55, qty: 10 }]);
    render(row({ ...noop, onRedeem, m: market({ outcome: 'yes', settlePriceUsd: 683.42 }), yes: 10, no: 0, pos, markYes: null }));
    expect(screen.getByText('YES won at $683.42')).toBeInTheDocument();
    expect(screen.getByTestId('unrealized')).toHaveTextContent('+$4.50'); // marked at 100¢
    await userEvent.click(screen.getByRole('button', { name: 'Redeem $10.00' }));
    expect(onRedeem).toHaveBeenCalledOnce();
  });

  it('losing tokens redeem for $0 (burn only)', () => {
    render(row({ ...noop, m: market({ outcome: 'yes', settlePriceUsd: 700 }), yes: 0, no: 4, pos: null, markYes: null }));
    expect(screen.getByRole('button', { name: 'Redeem $0.00' })).toBeInTheDocument();
  });

  it('offers to close YES+NO pairs for $1 each before settlement', () => {
    render(row({ ...noop, m: market(), yes: 3, no: 5, pos: null, markYes: 50 }));
    expect(screen.getByRole('button', { name: 'Close 3 pairs → $3' })).toBeInTheDocument();
  });
});
