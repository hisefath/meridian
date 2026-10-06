import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceStrip } from '@/components/PriceStrip';
import { usePrices } from '@/lib/meridian';

function Live() {
  const { prices, error } = usePrices(5_000);
  return <PriceStrip prices={prices} error={error} />;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('real-time oracle prices', () => {
  it('polls the Hermes proxy and re-renders as prices move', async () => {
    vi.useFakeTimers();
    let meta = 680;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ prices: { META: { price: meta, conf: 0.1, publishTime: Math.floor(Date.now() / 1000) } } }))),
    );
    render(<Live />);
    await act(async () => {});
    expect(screen.getByTestId('price-META')).toHaveTextContent('$680.00');
    expect(screen.getByTestId('price-META')).toHaveTextContent('live');
    meta = 684.25;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId('price-META')).toHaveTextContent('$684.25');
    expect(screen.getByTestId('price-AAPL')).toHaveTextContent('—');
  });

  it('degrades gracefully when the oracle key is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'PYTH_API_KEY is not configured' }), { status: 503 })));
    render(<Live />);
    await act(async () => {});
    expect(screen.getByTestId('price-META')).toHaveTextContent('oracle unavailable');
  });
});
