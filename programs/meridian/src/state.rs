use anchor_lang::prelude::*;

/// 1 contract pays 1 USDC = 1_000_000 base units (USDC has 6 decimals).
pub const USDC_PER_CONTRACT: u64 = 1_000_000;
/// Prices are whole cents in [1, 99]; 1 cent of a contract = 10_000 USDC base units.
pub const USDC_PER_CENT: u64 = 10_000;
pub const MAX_PRICE_CENTS: u8 = 99;
pub const NUM_TICKERS: usize = 7;
// ponytail: 64 slots, linear-scan matching. Bump (account must stay < 10 KB for CPI init)
// or move to a crit-bit tree if a strike ever needs deeper books.
pub const MAX_ORDERS: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Two-step admin handover: proposed by `set_admin`, takes effect on `accept_admin`.
    pub pending_admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub paused: bool,
    /// Max |publish_time - close_ts| accepted at settlement. Orders also stop this long
    /// before the close, so no oracle print that could settle the market is public while
    /// the book is still open.
    pub max_staleness_secs: u32,
    /// Max oracle confidence as a fraction of price, in basis points.
    pub max_conf_bps: u16,
    /// Admin override settle is only allowed this long after close.
    pub override_delay_secs: u32,
    /// ASCII tickers, zero-padded ("AAPL\0\0\0\0").
    pub tickers: [[u8; 8]; NUM_TICKERS],
    /// Pyth feed id per ticker, same index as `tickers`.
    pub feed_ids: [[u8; 32]; NUM_TICKERS],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Outcome {
    Open,
    YesWon,
    NoWon,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub ticker: u8,
    /// Strike in micro-USD (1e-6 USD).
    pub strike: u64,
    /// Unix seconds; trading and minting stop at this instant, settlement opens.
    pub close_ts: i64,
    pub created_at: i64,
    /// USDC base units the vault owes holders. Changed only by mint/redeem.
    pub collateral: u64,
    pub outcome: Outcome,
    /// Settlement price in micro-USD (0 while open).
    pub settle_price: u64,
    pub settled_at: i64,
    pub settled_by_override: bool,
    pub bump: u8,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey,
    pub book: Pubkey,
    pub book_usdc: Pubkey,
    pub book_yes: Pubkey,
}

impl Market {
    pub fn is_open(&self) -> bool {
        self.outcome == Outcome::Open
    }
}

pub const SIDE_BID: u8 = 0;
pub const SIDE_ASK: u8 = 1;

/// One resting order. A slot is free when `qty == 0 && claimable == 0`.
/// `claimable` is what fills have earned the maker and not yet been withdrawn:
/// YES contracts for a bid, USDC base units for an ask.
#[zero_copy]
#[derive(Default, Debug, PartialEq)]
pub struct Order {
    pub owner: Pubkey,
    pub qty: u64,
    pub claimable: u64,
    pub seq: u64,
    pub price: u8,
    pub side: u8,
    pub _pad: [u8; 6],
}

impl Order {
    pub fn is_free(&self) -> bool {
        self.qty == 0 && self.claimable == 0
    }
}

#[account(zero_copy)]
pub struct OrderBook {
    pub market: Pubkey,
    pub next_seq: u64,
    pub orders: [Order; MAX_ORDERS],
}

#[error_code]
pub enum MeridianError {
    #[msg("Signer is not the admin")]
    Unauthorized,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Invalid ticker index")]
    InvalidTicker,
    #[msg("Invalid strike")]
    InvalidStrike,
    #[msg("Close time must be in the future")]
    CloseInPast,
    #[msg("Invalid config parameter")]
    InvalidConfig,
    #[msg("Market is closed for trading and minting")]
    MarketClosed,
    #[msg("Market already settled")]
    AlreadySettled,
    #[msg("Market not settled yet")]
    NotSettled,
    #[msg("Too early to settle: market has not closed")]
    TooEarlyToSettle,
    #[msg("Admin override not allowed yet: delay after close has not elapsed")]
    OverrideTooEarly,
    #[msg("Quantity must be positive")]
    ZeroQuantity,
    #[msg("Price must be between 1 and 99 cents")]
    InvalidPrice,
    #[msg("Order book is full")]
    BookFull,
    #[msg("Fill-or-kill order could not be fully filled")]
    FillOrKillNotFilled,
    #[msg("Order not found")]
    OrderNotFound,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Oracle account is not owned by the Pyth receiver")]
    OracleWrongOwner,
    #[msg("Oracle account is not a PriceUpdateV2")]
    OracleBadAccount,
    #[msg("Oracle update is only partially verified")]
    OracleNotFullyVerified,
    #[msg("Oracle feed id does not match this market's ticker")]
    OracleWrongFeed,
    #[msg("Oracle price is too far from the market close time")]
    OracleStale,
    #[msg("Oracle confidence interval is too wide")]
    OracleConfidenceTooWide,
    #[msg("Oracle price is not positive")]
    OracleBadPrice,
    #[msg("Collateral invariant violated")]
    InvariantViolated,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub ticker: u8,
    pub strike: u64,
    pub close_ts: i64,
    pub intraday: bool,
}

#[event]
pub struct PairsMinted {
    pub market: Pubkey,
    pub user: Pubkey,
    pub qty: u64,
}

#[event]
pub struct PairsRedeemed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub qty: u64,
}

#[event]
pub struct OrderPlaced {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub seq: u64,
    pub side: u8,
    pub price: u8,
    pub qty: u64,
    pub filled: u64,
    pub rested: u64,
}

/// One maker order hit by a taker. `taker_side` is the taker's side.
#[event]
pub struct Fill {
    pub market: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub maker_seq: u64,
    pub taker_side: u8,
    pub price: u8,
    pub qty: u64,
}

#[event]
pub struct OrderCancelled {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub seq: u64,
    pub qty: u64,
}

#[event]
pub struct FillsClaimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub usdc: u64,
    pub yes: u64,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub price: u64,
    pub outcome: Outcome,
    pub by_override: bool,
}

#[event]
pub struct Redeemed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub yes_burned: u64,
    pub no_burned: u64,
    pub payout: u64,
}
