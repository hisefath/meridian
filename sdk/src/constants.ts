import { PublicKey } from '@solana/web3.js';
import idl from './idl/meridian.json';

/** Taken from the IDL so a redeploy under a new program id needs no code change. */
export const PROGRAM_ID = new PublicKey(idl.address);
export const PYTH_RECEIVER_ID = new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ');

export const TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'] as const;
export type Ticker = (typeof TICKERS)[number];

/** Pyth Core feed ids (Equity.US.<T>/USD, regular session). */
export const FEED_IDS: Record<Ticker, string> = {
  AAPL: '49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
  MSFT: 'd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1',
  GOOGL: '5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6',
  AMZN: 'b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a',
  NVDA: 'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  META: '78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe',
  TSLA: '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
};

export const USDC_DECIMALS = 6;
export const USDC_PER_CONTRACT = 1_000_000;
export const USDC_PER_CENT = 10_000;
/** micro-USD per USD: strikes and oracle prices are stored as integer micro-USD. */
export const MICRO = 1_000_000;
export const MAX_ORDERS = 64;
