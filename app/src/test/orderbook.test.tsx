import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderBook } from '@/components/OrderBook';
import { BOOK, order } from './fixtures';

describe('order book: one book, YES and NO views', () => {
  it('renders YES levels and the mirrored NO view of the same book', () => {
    render(<OrderBook orders={BOOK} />);
    const yes = within(screen.getByRole('region', { name: 'YES book' }));
    const no = within(screen.getByRole('region', { name: 'NO view' }));
    expect(yes.getAllByTestId('bid-level').map((r) => r.textContent)).toEqual(['58¢15', '55¢3']);
    expect(yes.getAllByTestId('ask-level').map((r) => r.textContent)).toEqual(['65¢20', '62¢7']); // best ask nearest the spread
    // NO ask = 100 − YES bid, NO bid = 100 − YES ask
    expect(no.getAllByTestId('ask-level').map((r) => r.textContent)).toEqual(['45¢3', '42¢15']);
    expect(no.getAllByTestId('bid-level').map((r) => r.textContent)).toEqual(['38¢7', '35¢20']);
    expect(yes.getByText('spread 4¢')).toBeInTheDocument();
  });

  it('updates when the book account changes (websocket push re-renders with new orders)', () => {
    const { rerender } = render(<OrderBook orders={BOOK} />);
    rerender(<OrderBook orders={[...BOOK, order(0, 60, 9)]} />);
    const yes = within(screen.getByRole('region', { name: 'YES book' }));
    expect(yes.getAllByTestId('bid-level')[0].textContent).toBe('60¢9');
    expect(yes.getByText('spread 2¢')).toBeInTheDocument();
  });

  it('shows a loading state before the first account fetch', () => {
    render(<OrderBook orders={null} />);
    expect(screen.getByText(/Loading order book/)).toBeInTheDocument();
  });
});
