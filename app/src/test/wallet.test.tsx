import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

// --- wallet + RPC fakes -------------------------------------------------------
const USDC = 'Hfc3dPjuECg2n6qk3b8C4G2J2GeMnxKM7KAJ4zzCV4Qg';
const wallet = { publicKey: null as PublicKey | null, sendTransaction: vi.fn() };
const connection = {
  getParsedTokenAccountsByOwner: vi.fn(async () => ({
    value: [{ account: { data: { parsed: { info: { mint: USDC, tokenAmount: { amount: '25500000' } } } } } }],
  })),
  getLatestBlockhash: vi.fn(async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 10 })),
  confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
};
vi.mock('@solana/wallet-adapter-react', () => ({ useWallet: () => wallet, useConnection: () => ({ connection }) }));
vi.mock('@solana/wallet-adapter-react-ui', () => ({ WalletMultiButton: () => <button>{wallet.publicKey ? 'Disconnect' : 'Select Wallet'}</button> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/markets' }));

import { Nav } from '@/components/Nav';
import { useSend } from '@/lib/meridian';

beforeEach(() => {
  wallet.publicKey = null;
  wallet.sendTransaction.mockReset();
});

describe('wallet connection flow', () => {
  it('shows the connect button and no balance while disconnected', () => {
    render(<Nav />);
    expect(screen.getByRole('button', { name: 'Select Wallet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('USDC balance')).toBeNull();
  });

  it('shows the USDC balance and faucet once connected', async () => {
    wallet.publicKey = Keypair.generate().publicKey;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ signature: 'x' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Nav />);
    await waitFor(() => expect(screen.getByLabelText('USDC balance')).toHaveTextContent('$25.50'));
    await userEvent.click(screen.getByRole('button', { name: 'Get test USDC' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/faucet', expect.objectContaining({ method: 'POST', body: JSON.stringify({ address: wallet.publicKey.toBase58() }) }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('+100 test USDC'));
  });
});

describe('transaction signing', () => {
  function Harness({ ixs, onResult }: { ixs: any[]; onResult: (s: string) => void }) {
    const { send, status } = useSend();
    return (
      <>
        <button onClick={() => send(ixs, 'Buy YES').then(onResult, () => {})}>go</button>
        <p>{status.msg}</p>
      </>
    );
  }

  it('builds ONE versioned transaction with every instruction and asks the wallet to sign once', async () => {
    wallet.publicKey = Keypair.generate().publicKey;
    wallet.sendTransaction.mockResolvedValue('5ig');
    const ix = (n: number) => ({ programId: new PublicKey(Keypair.generate().publicKey), keys: [], data: Buffer.from([n]) });
    const onResult = vi.fn();
    render(<Harness ixs={[ix(1), ix(2)]} onResult={onResult} />);
    await act(() => userEvent.click(screen.getByText('go')));
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    const tx = wallet.sendTransaction.mock.calls[0][0] as VersionedTransaction;
    expect(tx).toBeInstanceOf(VersionedTransaction);
    expect(tx.message.compiledInstructions).toHaveLength(3); // compute budget + both instructions
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('5ig'));
    expect(screen.getByText('Buy YES: confirmed')).toBeInTheDocument();
  });

  it('surfaces the program error when the wallet/simulation rejects', async () => {
    wallet.publicKey = Keypair.generate().publicKey;
    wallet.sendTransaction.mockRejectedValue(Object.assign(new Error('Simulation failed'), { logs: ['Program log: AnchorError ... Error Message: Market is closed for trading and minting.'] }));
    render(<Harness ixs={[]} onResult={vi.fn()} />);
    await act(() => userEvent.click(screen.getByText('go')));
    await waitFor(() => expect(screen.getByText('Buy YES: Market is closed for trading and minting.')).toBeInTheDocument());
  });
});
