import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import type { BorshInstructionCoder } from '@coral-xyz/anchor';
import { MeridianClient, createProgram, intentInstructions } from '@meridian/sdk';
import { TradePanel, marketQuote } from '@/components/TradePanel';
import { BOOK } from './fixtures';

const base = { ticker: 'META', strikeUsd: 680, orders: BOOK, connected: true, tradingOpen: true };

describe('order placement', () => {
  it('Buy YES market order submits a fill-or-kill intent at the worst price it walks to', async () => {
    const onSubmit = vi.fn().mockResolvedValue('sig');
    render(<TradePanel {...base} holdings={{ yes: 0, no: 0, usdc: 100 }} onSubmit={onSubmit} />);
    const qty = screen.getByLabelText('Contracts');
    await userEvent.clear(qty);
    await userEvent.type(qty, '9'); // 7 @ 62 + 2 @ 65
    expect(screen.getByTestId('payoff')).toHaveTextContent('You pay $5.67. You win $9.00 if META closes at or above $680.');
    await userEvent.click(screen.getByRole('button', { name: 'Buy YES 9' }));
    expect(onSubmit).toHaveBeenCalledWith({ action: 'buyYes', qty: 9, price: 65, kind: 'market' });
  });

  it('Buy NO prices off the YES bids: NO = 100 − bid', async () => {
    const onSubmit = vi.fn().mockResolvedValue('sig');
    render(<TradePanel {...base} holdings={{ yes: 0, no: 0, usdc: 100 }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Buy NO' }));
    await userEvent.click(screen.getByRole('button', { name: 'Buy NO 10' }));
    expect(onSubmit).toHaveBeenCalledWith({ action: 'buyNo', qty: 10, price: 42, kind: 'market' });
    expect(marketQuote('buyNo', BOOK, 16)).toEqual({ worst: 45, avg: 100 - (15 * 58 + 55) / 16 });
  });

  it('limit orders use the typed price and refuse market orders the book cannot fill', async () => {
    render(<TradePanel {...base} holdings={{ yes: 0, no: 0, usdc: 100 }} onSubmit={vi.fn()} />);
    const qty = screen.getByLabelText('Contracts');
    await userEvent.clear(qty);
    await userEvent.type(qty, '500');
    expect(screen.getByRole('alert')).toHaveTextContent(/Not enough liquidity/);
    await userEvent.click(screen.getByLabelText('Limit'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('intents compile to one atomic transaction: Buy NO = mint_pair + ask; Sell NO = bid + redeem_pair', async () => {
    const client = new MeridianClient(createProgram(), Keypair.generate().publicKey);
    const user = Keypair.generate().publicKey;
    const m = Keypair.generate().publicKey;
    const names = async (i: Parameters<typeof intentInstructions>[3]) =>
      (await intentInstructions(client, user, m, i))
        .filter((ix) => ix.programId.equals(client.programId))
        .map((ix) => (client.program.coder.instruction as BorshInstructionCoder).decode(ix.data)!.name);
    expect(await names({ action: 'buyYes', qty: 1, price: 60, kind: 'market' })).toEqual(['placeOrder']);
    expect(await names({ action: 'buyNo', qty: 1, price: 40, kind: 'market' })).toEqual(['mintPair', 'placeOrder']);
    expect(await names({ action: 'sellNo', qty: 1, price: 40, kind: 'market' })).toEqual(['placeOrder', 'redeemPair']);
    expect(await names({ action: 'sellNo', qty: 1, price: 40, kind: 'limit' })).toEqual(['placeOrder']);
  });
});

describe('position constraints', () => {
  it('blocks Buy YES while holding NO and guides the user to exit first', async () => {
    render(<TradePanel {...base} holdings={{ yes: 0, no: 3, usdc: 100 }} onSubmit={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You hold 3 NO. Sell your NO position before buying YES.');
    expect(screen.getByRole('button', { name: 'Buy YES 10' })).toBeDisabled();
    await userEvent.click(screen.getByRole('tab', { name: 'Sell NO' }));
    const qty = screen.getByLabelText('Contracts');
    await userEvent.clear(qty);
    await userEvent.type(qty, '3');
    expect(screen.getByRole('button', { name: 'Sell NO 3' })).toBeEnabled();
  });

  it('blocks Buy NO while holding YES', async () => {
    render(<TradePanel {...base} holdings={{ yes: 2, no: 0, usdc: 100 }} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Buy NO' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sell your YES position before buying NO');
  });

  it('is disabled when no wallet is connected or trading has closed', () => {
    const { rerender } = render(<TradePanel {...base} connected={false} holdings={{ yes: 0, no: 0, usdc: 0 }} onSubmit={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connect a wallet');
    rerender(<TradePanel {...base} tradingOpen={false} holdings={{ yes: 0, no: 0, usdc: 0 }} onSubmit={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Trading is closed');
  });
});
