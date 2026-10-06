import { Buffer } from 'buffer';
import { BN, Program, type Provider, type IdlAccounts } from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import idl from './idl/meridian.json';
import type { Meridian as MeridianIdl } from './idl/meridian';
import { FEED_IDS, TICKERS } from './constants';
import { configPda, marketAccounts, marketPda } from './pda';

export type MeridianProgram = Program<MeridianIdl>;
export type ConfigAccount = IdlAccounts<MeridianIdl>['config'];
export type MarketAccount = IdlAccounts<MeridianIdl>['market'];
export type OrderBookAccount = IdlAccounts<MeridianIdl>['orderBook'];
export type Side = 'bid' | 'ask';
export type OrderKind = 'limit' | 'ioc' | 'fok';

const ORDER_TYPE = { limit: { limit: {} }, ioc: { immediateOrCancel: {} }, fok: { fillOrKill: {} } } as const;
const SIDE = { bid: { bid: {} }, ask: { ask: {} } } as const;

/** Read-only provider: building instructions and decoding accounts never needs a wallet. */
export function createProgram(connection: Connection = new Connection('http://127.0.0.1:8899')): MeridianProgram {
  return new Program(idl as MeridianIdl, { connection } as Provider);
}

export const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

export function tickerBytes(): number[][] {
  return TICKERS.map((t) => {
    const b = new Array(8).fill(0);
    Buffer.from(t).forEach((c, i) => (b[i] = c));
    return b;
  });
}

export const feedIdBytes = (): number[][] => TICKERS.map((t) => [...Buffer.from(FEED_IDS[t], 'hex')]);

/**
 * Instruction builders for every program instruction. Pure: they only need
 * addresses, so the same code runs in the browser, the automation service and tests.
 */
export class MeridianClient {
  readonly config: PublicKey;

  constructor(readonly program: MeridianProgram, readonly usdcMint: PublicKey) {
    this.config = configPda(program.programId);
  }

  get programId() {
    return this.program.programId;
  }

  accounts(market: PublicKey) {
    return marketAccounts(market, this.programId);
  }

  marketAddress(ticker: number, closeTs: number, strikeMicro: bigint | number) {
    return marketPda(ticker, closeTs, strikeMicro, this.programId);
  }

  /** Create the user's USDC/YES/NO token accounts if missing (idempotent, safe to always include). */
  ensureTokenAccounts(payer: PublicKey, owner: PublicKey, market: PublicKey): TransactionInstruction[] {
    const { yesMint, noMint } = this.accounts(market);
    return [this.usdcMint, yesMint, noMint].map((mint) =>
      createAssociatedTokenAccountIdempotentInstruction(payer, ata(owner, mint), owner, mint),
    );
  }

  initializeConfig(admin: PublicKey, p: { maxStalenessSecs: number; maxConfBps: number; overrideDelaySecs: number }) {
    return this.program.methods
      .initializeConfig({
        maxStalenessSecs: p.maxStalenessSecs,
        maxConfBps: p.maxConfBps,
        overrideDelaySecs: p.overrideDelaySecs,
        tickers: tickerBytes(),
        feedIds: feedIdBytes(),
      })
      .accountsStrict({ admin, config: this.config, usdcMint: this.usdcMint, systemProgram: SystemProgram.programId })
      .instruction();
  }

  setPaused(admin: PublicKey, paused: boolean) {
    return this.program.methods.setPaused(paused).accountsStrict({ admin, config: this.config }).instruction();
  }

  setAdmin(admin: PublicKey, newAdmin: PublicKey) {
    return this.program.methods.setAdmin(newAdmin).accountsStrict({ admin, config: this.config }).instruction();
  }

  createStrikeMarket(admin: PublicKey, ticker: number, strikeMicro: bigint | number, closeTs: number, intraday = false) {
    const market = this.marketAddress(ticker, closeTs, strikeMicro);
    const a = this.accounts(market);
    const method = intraday ? this.program.methods.addStrike : this.program.methods.createStrikeMarket;
    return method(ticker, new BN(strikeMicro.toString()), new BN(closeTs))
      .accountsStrict({
        admin,
        config: this.config,
        market,
        yesMint: a.yesMint,
        noMint: a.noMint,
        vault: a.vault,
        book: a.book,
        bookUsdc: a.bookUsdc,
        bookYes: a.bookYes,
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  private redeemAccounts(user: PublicKey, market: PublicKey) {
    const a = this.accounts(market);
    return {
      user,
      market,
      yesMint: a.yesMint,
      noMint: a.noMint,
      vault: a.vault,
      userUsdc: ata(user, this.usdcMint),
      userYes: ata(user, a.yesMint),
      userNo: ata(user, a.noMint),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  mintPair(user: PublicKey, market: PublicKey, qty: number) {
    return this.program.methods
      .mintPair(new BN(qty))
      .accountsStrict({ ...this.redeemAccounts(user, market), config: this.config })
      .instruction();
  }

  redeemPair(user: PublicKey, market: PublicKey, qty: number) {
    return this.program.methods.redeemPair(new BN(qty)).accountsStrict(this.redeemAccounts(user, market)).instruction();
  }

  redeem(user: PublicKey, market: PublicKey) {
    return this.program.methods.redeem().accountsStrict(this.redeemAccounts(user, market)).instruction();
  }

  private tradeAccounts(user: PublicKey, market: PublicKey) {
    const a = this.accounts(market);
    return {
      user,
      config: this.config,
      market,
      book: a.book,
      bookUsdc: a.bookUsdc,
      bookYes: a.bookYes,
      userUsdc: ata(user, this.usdcMint),
      userYes: ata(user, a.yesMint),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  placeOrder(user: PublicKey, market: PublicKey, side: Side, priceCents: number, qty: number, kind: OrderKind) {
    return this.program.methods
      .placeOrder(SIDE[side], priceCents, new BN(qty), ORDER_TYPE[kind])
      .accountsStrict(this.tradeAccounts(user, market))
      .instruction();
  }

  cancelOrder(user: PublicKey, market: PublicKey, seq: number | BN) {
    return this.program.methods.cancelOrder(new BN(seq.toString())).accountsStrict(this.tradeAccounts(user, market)).instruction();
  }

  claimFills(user: PublicKey, market: PublicKey) {
    return this.program.methods.claimFills().accountsStrict(this.tradeAccounts(user, market)).instruction();
  }

  settleMarket(market: PublicKey, priceUpdate: PublicKey) {
    return this.program.methods.settleMarket().accountsStrict({ config: this.config, market, priceUpdate }).instruction();
  }

  adminSettle(admin: PublicKey, market: PublicKey, priceMicro: bigint | number) {
    return this.program.methods
      .adminSettle(new BN(priceMicro.toString()))
      .accountsStrict({ admin, config: this.config, market })
      .instruction();
  }

  // ---- reads (need a real connection)
  fetchConfig() {
    return this.program.account.config.fetch(this.config);
  }

  fetchMarket(market: PublicKey) {
    return this.program.account.market.fetch(market);
  }

  fetchMarkets() {
    return this.program.account.market.all();
  }

  fetchBook(market: PublicKey) {
    return this.program.account.orderBook.fetch(this.accounts(market).book);
  }

  decodeBook(data: Buffer): OrderBookAccount {
    return this.program.coder.accounts.decode('orderBook', data);
  }

  decodeMarket(data: Buffer): MarketAccount {
    return this.program.coder.accounts.decode('market', data);
  }
}

export const tickerName = (i: number) => TICKERS[i] ?? `#${i}`;
export const outcomeOf = (m: Pick<MarketAccount, 'outcome'>): 'open' | 'yes' | 'no' =>
  'open' in m.outcome ? 'open' : 'yesWon' in m.outcome ? 'yes' : 'no';
