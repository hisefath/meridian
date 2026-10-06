import { FailedTransactionMetadata, LiteSVM, type TransactionMetadata } from 'litesvm';
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import {
  FEED_IDS,
  MeridianClient,
  PROGRAM_ID,
  PYTH_RECEIVER_ID,
  TICKERS,
  ata,
  createProgram,
  parseLogs,
  type Ticker,
} from '../sdk/src';

/** 2026-10-06 09:30 ET */
export const OPEN = 1_791_293_400;
/** 2026-10-06 16:00 ET */
export const CLOSE = 1_791_316_800;
export const USD = 1_000_000;

export class TxError extends Error {
  constructor(readonly logs: string[], detail: string) {
    super(`${detail}\n${logs.join('\n')}`);
  }
}

const PRICE_UPDATE_DISC = Buffer.from('22f123639d7ef4cd', 'hex');

export class Harness {
  readonly svm = new LiteSVM();
  readonly admin = Keypair.generate();
  readonly usdcMint = Keypair.generate();
  readonly client: MeridianClient;

  constructor() {
    this.svm.addProgramFromFile(PROGRAM_ID, 'target/deploy/meridian.so');
    this.svm.airdrop(this.admin.publicKey, BigInt(1_000 * LAMPORTS_PER_SOL));
    this.client = new MeridianClient(createProgram(), this.usdcMint.publicKey);
    this.setTime(OPEN);
    const rent = this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
    this.send(
      [
        SystemProgram.createAccount({
          fromPubkey: this.admin.publicKey,
          newAccountPubkey: this.usdcMint.publicKey,
          lamports: Number(rent),
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(this.usdcMint.publicKey, 6, this.admin.publicKey, null),
      ],
      [this.admin, this.usdcMint],
    );
  }

  static async ready(params = { maxStalenessSecs: 300, maxConfBps: 200, overrideDelaySecs: 3600 }) {
    const h = new Harness();
    h.send([await h.client.initializeConfig(h.admin.publicKey, params)], [h.admin]);
    return h;
  }

  send(ixs: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const res = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash(); // identical follow-up txs must not be deduplicated
    if (res instanceof FailedTransactionMetadata) throw new TxError(res.meta().logs(), res.toString());
    return res;
  }

  /** Expect the tx to fail with the given Anchor error name (e.g. "MarketClosed"). */
  fails(ixs: TransactionInstruction[], signers: Keypair[], errorName: string) {
    try {
      this.send(ixs, signers);
    } catch (e) {
      if (!(e instanceof TxError)) throw e;
      const hit = e.logs.some((l) => l.includes(`Error Code: ${errorName}`) || l.includes(errorName));
      if (!hit) throw new Error(`expected ${errorName}, got:\n${e.logs.join('\n')}`);
      return;
    }
    throw new Error(`expected failure ${errorName} but tx succeeded`);
  }

  events(meta: TransactionMetadata) {
    return parseLogs(this.client.program, meta.logs());
  }

  setTime(t: number) {
    const c = this.svm.getClock();
    c.unixTimestamp = BigInt(t);
    this.svm.setClock(c);
  }

  /** New funded user with `usdc` dollars and token accounts for the given markets. */
  user(usdc = 1_000, markets: PublicKey[] = []) {
    const kp = Keypair.generate();
    this.svm.airdrop(kp.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const usdcAta = ata(kp.publicKey, this.usdcMint.publicKey);
    this.send(
      [
        createAssociatedTokenAccountIdempotentInstruction(this.admin.publicKey, usdcAta, kp.publicKey, this.usdcMint.publicKey),
        createMintToInstruction(this.usdcMint.publicKey, usdcAta, this.admin.publicKey, usdc * USD),
      ],
      [this.admin],
    );
    for (const m of markets) this.send(this.client.ensureTokenAccounts(this.admin.publicKey, kp.publicKey, m), [this.admin]);
    return kp;
  }

  async market(ticker: Ticker, strikeUsd: number, closeTs = CLOSE) {
    const t = TICKERS.indexOf(ticker);
    this.send([await this.client.createStrikeMarket(this.admin.publicKey, t, strikeUsd * USD, closeTs)], [this.admin]);
    return this.client.marketAddress(t, closeTs, strikeUsd * USD);
  }

  tokenAmount(address: PublicKey): number {
    const acc = this.svm.getAccount(address);
    return acc ? Number(AccountLayout.decode(acc.data).amount) : 0;
  }

  usdc(owner: PublicKey) {
    return this.tokenAmount(ata(owner, this.usdcMint.publicKey));
  }

  yes(owner: PublicKey, market: PublicKey) {
    return this.tokenAmount(ata(owner, this.client.accounts(market).yesMint));
  }

  no(owner: PublicKey, market: PublicKey) {
    return this.tokenAmount(ata(owner, this.client.accounts(market).noMint));
  }

  supply(mint: PublicKey) {
    return Number(MintLayout.decode(this.svm.getAccount(mint)!.data).supply);
  }

  marketState(market: PublicKey) {
    return this.client.decodeMarket(Buffer.from(this.svm.getAccount(market)!.data));
  }

  book(market: PublicKey) {
    return this.client.decodeBook(Buffer.from(this.svm.getAccount(this.client.accounts(market).book)!.data));
  }

  donate(from: Keypair, to: PublicKey, amount: number) {
    this.send([createTransferInstruction(ata(from.publicKey, this.usdcMint.publicKey), to, from.publicKey, amount)], [from]);
  }

  /** Inject a Pyth PriceUpdateV2 account (same layout the receiver writes on devnet). */
  priceUpdate(o: {
    ticker: Ticker;
    priceUsd: number;
    publishTime: number;
    confUsd?: number;
    expo?: number;
    full?: boolean;
    owner?: PublicKey;
  }) {
    const expo = o.expo ?? -5;
    const scale = 10 ** -expo;
    const full = o.full ?? true;
    const buf = Buffer.alloc(134);
    let off = 0;
    PRICE_UPDATE_DISC.copy(buf, off);
    off += 8;
    off += 32; // write authority
    if (full) buf[off++] = 1;
    else {
      buf[off++] = 0;
      buf[off++] = 5; // Partial { num_signatures }
    }
    Buffer.from(FEED_IDS[o.ticker], 'hex').copy(buf, off);
    off += 32;
    buf.writeBigInt64LE(BigInt(Math.round(o.priceUsd * scale)), off);
    buf.writeBigUInt64LE(BigInt(Math.round((o.confUsd ?? 0.05) * scale)), off + 8);
    buf.writeInt32LE(expo, off + 16);
    buf.writeBigInt64LE(BigInt(o.publishTime), off + 20);
    const key = Keypair.generate().publicKey;
    this.svm.setAccount(key, {
      lamports: Number(this.svm.minimumBalanceForRentExemption(134n)),
      data: buf,
      owner: o.owner ?? PYTH_RECEIVER_ID,
      executable: false,
    });
    return key;
  }

  /** On-chain collateral must equal $1 × outstanding pairs exactly (no donations in play). */
  collateralSnapshot(market: PublicKey) {
    const a = this.client.accounts(market);
    const m = this.marketState(market);
    return {
      vault: this.tokenAmount(a.vault),
      collateral: Number(m.collateral),
      yesSupply: this.supply(a.yesMint),
      noSupply: this.supply(a.noMint),
    };
  }
}
