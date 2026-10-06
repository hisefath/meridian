#![allow(deprecated)] // anchor_spl::token::transfer — we don't need transfer_checked's extra mint account
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod book;
pub mod oracle;
pub mod state;

use book::{OrderType, Side};
use state::*;

/// Signer seeds for the Market PDA (it owns the mints, vault and escrows).
macro_rules! market_seeds {
    ($m:expr) => {
        [
            b"market".as_ref(),
            std::slice::from_ref(&$m.ticker),
            &$m.close_ts.to_le_bytes(),
            &$m.strike.to_le_bytes(),
            std::slice::from_ref(&$m.bump),
        ]
    };
}

declare_id!("2rnq72LPCH1aAGKvJrFU6YWAy6XCQh2ERofPhuqA7YCG");

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigParams {
    pub max_staleness_secs: u32,
    pub max_conf_bps: u16,
    pub override_delay_secs: u32,
    pub tickers: [[u8; 8]; NUM_TICKERS],
    pub feed_ids: [[u8; 32]; NUM_TICKERS],
}

#[program]
pub mod meridian {
    use super::*;

    /// One-time global setup: admin, collateral mint, tickers + Pyth feeds, oracle thresholds.
    pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams) -> Result<()> {
        require!(params.max_staleness_secs > 0, MeridianError::InvalidConfig);
        require!(params.max_conf_bps > 0 && params.max_conf_bps <= 10_000, MeridianError::InvalidConfig);
        // the override must never pre-empt a still-valid oracle print
        require!(
            params.override_delay_secs >= 60 && params.override_delay_secs > params.max_staleness_secs,
            MeridianError::InvalidConfig
        );
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.pending_admin = Pubkey::default();
        c.usdc_mint = ctx.accounts.usdc_mint.key();
        c.paused = false;
        c.max_staleness_secs = params.max_staleness_secs;
        c.max_conf_bps = params.max_conf_bps;
        c.override_delay_secs = params.override_delay_secs;
        c.tickers = params.tickers;
        c.feed_ids = params.feed_ids;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Propose a new admin (e.g. a multisig). Nothing changes until it calls `accept_admin`,
    /// so a typo can't lock the protocol out of pause and override.
    pub fn set_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = c.pending_admin;
        c.pending_admin = Pubkey::default();
        Ok(())
    }

    /// Emergency stop for minting and new orders. Exits (cancel/claim/redeem) stay open.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Morning job: one market (YES/NO mints, vault, order book, escrows) per strike.
    pub fn create_strike_market(ctx: Context<CreateStrikeMarket>, ticker: u8, strike: u64, close_ts: i64) -> Result<()> {
        create_market(ctx, ticker, strike, close_ts, false)
    }

    /// Admin adds an extra strike intraday. Same accounts and checks as the morning path.
    pub fn add_strike(ctx: Context<CreateStrikeMarket>, ticker: u8, strike: u64, close_ts: i64) -> Result<()> {
        create_market(ctx, ticker, strike, close_ts, true)
    }

    /// Deposit `qty` USDC, receive `qty` YES + `qty` NO.
    pub fn mint_pair(ctx: Context<MintPair>, qty: u64) -> Result<()> {
        require!(qty > 0, MeridianError::ZeroQuantity);
        require!(!ctx.accounts.config.paused, MeridianError::Paused);
        let market = &ctx.accounts.market;
        require!(market.is_open() && now()? < market.close_ts, MeridianError::MarketClosed);

        let amount = qty.checked_mul(USDC_PER_CONTRACT).ok_or(MeridianError::Overflow)?;
        let a = &ctx.accounts;
        token::transfer(
            CpiContext::new(
                a.token_program.to_account_info(),
                Transfer { from: a.user_usdc.to_account_info(), to: a.vault.to_account_info(), authority: a.user.to_account_info() },
            ),
            amount,
        )?;
        let seeds = market_seeds!(market);
        for (mint, to) in [(&a.yes_mint, &a.user_yes), (&a.no_mint, &a.user_no)] {
            token::mint_to(
                CpiContext::new_with_signer(
                    a.token_program.to_account_info(),
                    MintTo { mint: mint.to_account_info(), to: to.to_account_info(), authority: market.to_account_info() },
                    &[&seeds[..]],
                ),
                qty,
            )?;
        }
        let key = market.key();
        let m = &mut ctx.accounts.market;
        m.collateral = m.collateral.checked_add(amount).ok_or(MeridianError::Overflow)?;
        check_collateral(&mut ctx.accounts.vault, &mut ctx.accounts.yes_mint, &mut ctx.accounts.no_mint, m)?;
        emit!(PairsMinted { market: key, user: ctx.accounts.user.key(), qty });
        Ok(())
    }

    /// Burn `qty` YES + `qty` NO for `qty` USDC. Allowed any time, including while paused.
    pub fn redeem_pair(ctx: Context<Redeem>, qty: u64) -> Result<()> {
        require!(qty > 0, MeridianError::ZeroQuantity);
        let a = &ctx.accounts;
        for (mint, from) in [(&a.yes_mint, &a.user_yes), (&a.no_mint, &a.user_no)] {
            burn(a, mint, from, qty)?;
        }
        let amount = qty.checked_mul(USDC_PER_CONTRACT).ok_or(MeridianError::Overflow)?;
        pay_from_vault(a, amount)?;
        let key = a.market.key();
        let m = &mut ctx.accounts.market;
        m.collateral = m.collateral.checked_sub(amount).ok_or(MeridianError::InvariantViolated)?;
        check_collateral(&mut ctx.accounts.vault, &mut ctx.accounts.yes_mint, &mut ctx.accounts.no_mint, m)?;
        emit!(PairsRedeemed { market: key, user: ctx.accounts.user.key(), qty });
        Ok(())
    }

    /// After settlement: burn all of the caller's YES and NO, pay $1 per winning token.
    pub fn redeem(ctx: Context<Redeem>) -> Result<()> {
        let a = &ctx.accounts;
        require!(!a.market.is_open(), MeridianError::NotSettled);
        let (yes, no) = (a.user_yes.amount, a.user_no.amount);
        require!(yes > 0 || no > 0, MeridianError::ZeroQuantity);
        burn(a, &a.yes_mint, &a.user_yes, yes)?;
        burn(a, &a.no_mint, &a.user_no, no)?;
        let winning = if a.market.outcome == Outcome::YesWon { yes } else { no };
        let payout = winning.checked_mul(USDC_PER_CONTRACT).ok_or(MeridianError::Overflow)?;
        pay_from_vault(a, payout)?;
        let key = a.market.key();
        let m = &mut ctx.accounts.market;
        m.collateral = m.collateral.checked_sub(payout).ok_or(MeridianError::InvariantViolated)?;
        check_collateral(&mut ctx.accounts.vault, &mut ctx.accounts.yes_mint, &mut ctx.accounts.no_mint, m)?;
        emit!(Redeemed { market: key, user: ctx.accounts.user.key(), yes_burned: yes, no_burned: no, payout });
        Ok(())
    }

    /// Place a YES order. Bid = buy YES (escrows USDC), Ask = sell YES (escrows YES).
    /// Takers settle immediately; makers accrue `claimable` on their slot.
    pub fn place_order(ctx: Context<Trade>, side: Side, price: u8, qty: u64, order_type: OrderType) -> Result<()> {
        require!(!ctx.accounts.config.paused, MeridianError::Paused);
        let market = &ctx.accounts.market;
        // The book closes `max_staleness_secs` before close_ts: any print inside the settlement
        // window is public the moment it's published, so trading through it would let anyone
        // trade on a known outcome.
        let halt = market.close_ts - ctx.accounts.config.max_staleness_secs as i64;
        require!(market.is_open() && now()? < halt, MeridianError::MarketClosed);
        let owner = ctx.accounts.user.key();
        let e = {
            let mut book = ctx.accounts.book.load_mut()?;
            book::execute(&mut book, owner, side, price, qty, order_type)?
        };
        let a = &ctx.accounts;
        let notional = e.notional_cents.checked_mul(USDC_PER_CENT).ok_or(MeridianError::Overflow)?;
        match side {
            Side::Bid => {
                let rest_escrow = (price as u64)
                    .checked_mul(e.rested)
                    .and_then(|c| c.checked_mul(USDC_PER_CENT))
                    .ok_or(MeridianError::Overflow)?;
                deposit(a, &a.user_usdc, &a.book_usdc, notional + rest_escrow)?;
                pay_from_book(a, 0, e.filled)?;
            }
            Side::Ask => {
                deposit(a, &a.user_yes, &a.book_yes, e.filled + e.rested)?;
                pay_from_book(a, notional, 0)?;
            }
        }
        let key = market.key();
        for f in &e.fills {
            emit!(Fill { market: key, maker: f.maker, taker: owner, maker_seq: f.maker_seq, taker_side: side.as_u8(), price: f.price, qty: f.qty });
        }
        emit!(OrderPlaced { market: key, owner, seq: e.seq, side: side.as_u8(), price, qty, filled: e.filled, rested: e.rested });
        Ok(())
    }

    /// Remove one of the caller's orders; refunds escrow plus anything already earned.
    pub fn cancel_order(ctx: Context<Trade>, seq: u64) -> Result<()> {
        let owner = ctx.accounts.user.key();
        let (usdc, yes, qty) = {
            let mut book = ctx.accounts.book.load_mut()?;
            let o = book
                .orders
                .iter_mut()
                .find(|o| !o.is_free() && o.seq == seq && o.owner == owner)
                .ok_or(MeridianError::OrderNotFound)?;
            let (usdc, yes) = book::release(o)?;
            let qty = o.qty;
            *o = Order::default();
            (usdc, yes, qty)
        };
        pay_from_book(&ctx.accounts, usdc, yes)?;
        emit!(OrderCancelled { market: ctx.accounts.market.key(), owner, seq, qty });
        Ok(())
    }

    /// Withdraw everything fills have earned the caller on this book.
    pub fn claim_fills(ctx: Context<Trade>) -> Result<()> {
        let owner = ctx.accounts.user.key();
        let (mut usdc, mut yes) = (0u64, 0u64);
        {
            let mut book = ctx.accounts.book.load_mut()?;
            for o in book.orders.iter_mut().filter(|o| o.owner == owner && o.claimable > 0) {
                if o.side == SIDE_BID {
                    yes = yes.checked_add(o.claimable).ok_or(MeridianError::Overflow)?;
                } else {
                    usdc = usdc.checked_add(o.claimable).ok_or(MeridianError::Overflow)?;
                }
                o.claimable = 0;
                if o.qty == 0 {
                    *o = Order::default();
                }
            }
        }
        require!(usdc > 0 || yes > 0, MeridianError::NothingToClaim);
        pay_from_book(&ctx.accounts, usdc, yes)?;
        emit!(FillsClaimed { market: ctx.accounts.market.key(), owner, usdc, yes });
        Ok(())
    }

    /// Permissionless: push a slot's earned proceeds to its owner's token accounts and free it
    /// if fully filled. Without this, filled-but-unclaimed slots could be farmed (64 tiny
    /// self-trades) to keep the book full; any maker can crank them before quoting.
    pub fn crank_claim(ctx: Context<CrankClaim>, seq: u64) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        let (usdc, yes) = {
            let mut book = ctx.accounts.book.load_mut()?;
            let o = book
                .orders
                .iter_mut()
                .find(|o| !o.is_free() && o.seq == seq && o.owner == owner)
                .ok_or(MeridianError::OrderNotFound)?;
            require!(o.claimable > 0, MeridianError::NothingToClaim);
            let paid = if o.side == SIDE_BID { (0, o.claimable) } else { (o.claimable, 0) };
            o.claimable = 0;
            if o.qty == 0 {
                *o = Order::default();
            }
            paid
        };
        let a = &ctx.accounts;
        let seeds = market_seeds!(a.market);
        for (from, to, amount) in [(&a.book_usdc, &a.owner_usdc, usdc), (&a.book_yes, &a.owner_yes, yes)] {
            if amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        a.token_program.to_account_info(),
                        Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: a.market.to_account_info() },
                        &[&seeds[..]],
                    ),
                    amount,
                )?;
            }
        }
        emit!(FillsClaimed { market: a.market.key(), owner, usdc, yes });
        Ok(())
    }

    /// Permissionless: settle from a fully-verified Pyth price at the close.
    pub fn settle_market(ctx: Context<SettleMarket>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.is_open(), MeridianError::AlreadySettled);
        require!(now()? >= market.close_ts, MeridianError::TooEarlyToSettle);
        let acc = &ctx.accounts.price_update;
        require_keys_eq!(*acc.owner, oracle::PYTH_RECEIVER_ID, MeridianError::OracleWrongOwner);
        let p = oracle::parse_price_update(&acc.try_borrow_data()?)?;
        let c = &ctx.accounts.config;
        let price = oracle::validate(&p, &c.feed_ids[market.ticker as usize], market.close_ts, c.max_staleness_secs, c.max_conf_bps)?;
        write_outcome(&mut ctx.accounts.market, price, false)
    }

    /// Emergency fallback when the oracle path failed: admin-supplied price, only after the delay.
    pub fn admin_settle(ctx: Context<AdminSettle>, price: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.is_open(), MeridianError::AlreadySettled);
        require!(price > 0, MeridianError::OracleBadPrice);
        let earliest = market
            .close_ts
            .checked_add(ctx.accounts.config.override_delay_secs as i64)
            .ok_or(MeridianError::Overflow)?;
        require!(now()? >= earliest, MeridianError::OverrideTooEarly);
        write_outcome(&mut ctx.accounts.market, price, true)
    }
}

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}


fn create_market(mut ctx: Context<CreateStrikeMarket>, ticker: u8, strike: u64, close_ts: i64, intraday: bool) -> Result<()> {
    require!((ticker as usize) < NUM_TICKERS, MeridianError::InvalidTicker);
    require!(strike > 0, MeridianError::InvalidStrike);
    let t = now()?;
    require!(close_ts > t, MeridianError::CloseInPast);

    let a = &mut ctx.accounts;
    let key = a.market.key();
    a.market.set_inner(Market {
        ticker,
        strike,
        close_ts,
        created_at: t,
        collateral: 0,
        outcome: Outcome::Open,
        settle_price: 0,
        settled_at: 0,
        settled_by_override: false,
        bump: ctx.bumps.market,
        yes_mint: a.yes_mint.key(),
        no_mint: a.no_mint.key(),
        vault: a.vault.key(),
        book: a.book.key(),
        book_usdc: a.book_usdc.key(),
        book_yes: a.book_yes.key(),
    });
    let mut book = a.book.load_init()?;
    book.market = key;
    emit!(MarketCreated { market: key, ticker, strike, close_ts, intraday });
    Ok(())
}

/// Settlement rule: YES wins iff close >= strike (at-the-strike pays YES). Write-once.
pub fn outcome_for(price: u64, strike: u64) -> Outcome {
    if price >= strike {
        Outcome::YesWon
    } else {
        Outcome::NoWon
    }
}

fn write_outcome(market: &mut Account<Market>, price: u64, by_override: bool) -> Result<()> {
    market.outcome = outcome_for(price, market.strike);
    market.settle_price = price;
    market.settled_at = now()?;
    market.settled_by_override = by_override;
    emit!(MarketSettled { market: market.key(), price, outcome: market.outcome, by_override });
    Ok(())
}

/// On-chain collateral invariant, checked after every mint/redeem:
/// vault holds at least what's owed, and what's owed covers every live claim.
/// Raw `==` would let a 1-unit donation to the vault brick the market, so equality
/// is asserted in tests, solvency here.
fn check_collateral(
    vault: &mut Account<TokenAccount>,
    yes_mint: &mut Account<Mint>,
    no_mint: &mut Account<Mint>,
    m: &Market,
) -> Result<()> {
    vault.reload()?;
    yes_mint.reload()?;
    no_mint.reload()?;
    let backed = |supply: u64| supply.checked_mul(USDC_PER_CONTRACT).map_or(false, |need| m.collateral >= need);
    let covered = match m.outcome {
        Outcome::Open => backed(yes_mint.supply) && backed(no_mint.supply),
        Outcome::YesWon => backed(yes_mint.supply),
        Outcome::NoWon => backed(no_mint.supply),
    };
    require!(vault.amount >= m.collateral && covered, MeridianError::InvariantViolated);
    Ok(())
}

fn burn<'info>(a: &Redeem<'info>, mint: &Account<'info, Mint>, from: &Account<'info, TokenAccount>, qty: u64) -> Result<()> {
    if qty == 0 {
        return Ok(());
    }
    token::burn(
        CpiContext::new(
            a.token_program.to_account_info(),
            Burn { mint: mint.to_account_info(), from: from.to_account_info(), authority: a.user.to_account_info() },
        ),
        qty,
    )
}

fn pay_from_vault(a: &Redeem, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds = market_seeds!(a.market);
    token::transfer(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            Transfer { from: a.vault.to_account_info(), to: a.user_usdc.to_account_info(), authority: a.market.to_account_info() },
            &[&seeds[..]],
        ),
        amount,
    )
}

fn deposit<'info>(a: &Trade<'info>, from: &Account<'info, TokenAccount>, to: &Account<'info, TokenAccount>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer(
        CpiContext::new(
            a.token_program.to_account_info(),
            Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: a.user.to_account_info() },
        ),
        amount,
    )
}

fn pay_from_book(a: &Trade, usdc: u64, yes: u64) -> Result<()> {
    let seeds = market_seeds!(a.market);
    for (from, to, amount) in [(&a.book_usdc, &a.user_usdc, usdc), (&a.book_yes, &a.user_yes, yes)] {
        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    a.token_program.to_account_info(),
                    Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: a.market.to_account_info() },
                    &[&seeds[..]],
                ),
                amount,
            )?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ MeridianError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(address = config.pending_admin @ MeridianError::Unauthorized)]
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct CrankClaim<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(has_one = book, has_one = book_usdc, has_one = book_yes, has_one = yes_mint)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut)]
    pub book: AccountLoader<'info, OrderBook>,
    #[account(mut)]
    pub book_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub book_yes: Box<Account<'info, TokenAccount>>,
    /// CHECK: only used as the expected slot owner; funds go to its canonical ATAs.
    pub owner: UncheckedAccount<'info>,
    // ATAs can't be closed out from under the crank: anyone can (re)create them first in the same tx.
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = owner)]
    pub owner_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = yes_mint, associated_token::authority = owner)]
    pub owner_yes: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub yes_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(ticker: u8, strike: u64, close_ts: i64)]
pub struct CreateStrikeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ MeridianError::Unauthorized, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init, payer = admin, space = 8 + Market::INIT_SPACE,
        seeds = [b"market".as_ref(), &[ticker], &close_ts.to_le_bytes(), &strike.to_le_bytes()], bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(init, payer = admin, seeds = [b"yes", market.key().as_ref()], bump, mint::decimals = 0, mint::authority = market)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = admin, seeds = [b"no", market.key().as_ref()], bump, mint::decimals = 0, mint::authority = market)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = admin, seeds = [b"vault", market.key().as_ref()], bump, token::mint = usdc_mint, token::authority = market)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = admin, space = 8 + std::mem::size_of::<OrderBook>(), seeds = [b"book", market.key().as_ref()], bump)]
    pub book: AccountLoader<'info, OrderBook>,
    #[account(init, payer = admin, seeds = [b"book_usdc", market.key().as_ref()], bump, token::mint = usdc_mint, token::authority = market)]
    pub book_usdc: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = admin, seeds = [b"book_yes", market.key().as_ref()], bump, token::mint = yes_mint, token::authority = market)]
    pub book_yes: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintPair<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = yes_mint, has_one = no_mint, has_one = vault)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
    pub user_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    pub user: Signer<'info>,
    #[account(mut, has_one = yes_mint, has_one = no_mint, has_one = vault)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = vault.mint, token::authority = user)]
    pub user_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(has_one = book, has_one = book_usdc, has_one = book_yes)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut)]
    pub book: AccountLoader<'info, OrderBook>,
    #[account(mut)]
    pub book_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub book_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
    pub user_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = market.yes_mint, token::authority = user)]
    pub user_yes: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: owner, discriminator, verification level, feed id, time and confidence are validated in `settle_market`.
    pub price_update: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminSettle<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ MeridianError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        // The $1 invariant: for every price and strike exactly one side pays, so YES + NO = $1.
        #[test]
        fn yes_plus_no_is_one_dollar(price in any::<u64>(), strike in 1u64..u64::MAX) {
            let (yes, no) = match outcome_for(price, strike) {
                Outcome::YesWon => (USDC_PER_CONTRACT, 0),
                Outcome::NoWon => (0, USDC_PER_CONTRACT),
                Outcome::Open => unreachable!(),
            };
            prop_assert_eq!(yes + no, USDC_PER_CONTRACT);
            prop_assert_eq!(yes == USDC_PER_CONTRACT, price >= strike);
        }
    }

    #[test]
    fn at_the_strike_pays_yes() {
        assert_eq!(outcome_for(680_000_000, 680_000_000), Outcome::YesWon);
        assert_eq!(outcome_for(679_999_999, 680_000_000), Outcome::NoWon);
        assert_eq!(outcome_for(685_000_000, 680_000_000), Outcome::YesWon);
        assert_eq!(outcome_for(675_000_000, 680_000_000), Outcome::NoWon);
    }
}
