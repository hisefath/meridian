# Meridian — Product Requirements Document

**Product:** Meridian: binary stock-outcome markets on Solana
**Partner:** PEAK6 (technical contact: Myles Lewis)
**Status:** v1, devnet. The binding spec is the Gauntlet "Meridian" project brief; this PRD restates it and adds the assumptions we made while building.

---

## 1. Problem

Retail traders who want to express a simple directional view ("NVDA finishes the day above $190") have two bad options:

- **Stock**: the payoff is linear and capital-heavy.
- **Options**: Greeks, margin, assignment, early exercise. A same-day option is a lot of machinery for a yes/no view.

A **binary outcome contract** reduces the view to one question with a known cost and a known payout: *"Will META close at or above $680 today?"* A Yes token pays $1.00 USDC if it does and $0.00 if it doesn't. You know the maximum loss (what you paid) and the maximum gain ($1 minus what you paid) the moment you enter.

Running this **non-custodially on a fast chain** removes the intermediary. Collateral sits in program-owned vaults that anyone can audit, and the settlement rule is code rather than a back office.

## 2. Users

| Persona | Goal | What they need from Meridian |
|---|---|---|
| **Directional trader** (primary) | Bet on a MAG7 close vs. a strike | Browse strikes, see price = implied probability, Buy/Sell Yes or No in one click, see P&L, redeem winners |
| **Market maker** | Earn the spread by quoting both sides | Mint pairs at $1, post limit orders, see fills/exposure, claim proceeds |
| **Operator (admin)** | Keep the daily lifecycle running | Automated market creation and settlement, alerts, emergency pause, oracle-failure override |

## 3. Product scope (v1)

### 3.1 Instrument
- One contract = one (stock, strike, trading day). There are two complementary SPL tokens, **YES** and **NO**.
- YES pays $1 if `close ≥ strike` (an at-strike close pays YES). NO pays $1 if `close < strike`.
- **Invariant:** YES payout + NO payout = $1.00 for every contract and every possible price.
- Underlyings: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA.
- Expiry is same-day (0DTE) and settles at the official session close. That is 4:00 PM ET, or 1:00 PM ET on exchange early-close days.

### 3.2 Daily lifecycle

| Time (ET) | Event | Owner |
|---|---|---|
| 8:00 | Read previous close from the oracle and compute strikes at ±3/6/9% (+ATM), rounded to $10 and de-duplicated | Automation |
| 8:00–8:30 | Create one on-chain market per strike: mints, vault and order book | Automation |
| 9:00 | Markets visible; minting enabled | Frontend/Program |
| 9:30–16:00 | Trading on the on-chain order book | Users |
| 16:00 | **Trading and minting halt on-chain** (`now ≥ close_ts`) | Program |
| ~16:00–16:05 | Post the oracle closing price and settle every market | Automation (permissionless) |
| 16:05+ | Redemption: winners burn for $1 | Users |
| 17:00+ | Admin override is possible *only if* the oracle path failed (1h delay) | Admin |
| Forever | Unredeemed tokens remain redeemable | Program |

### 3.3 Functional requirements

| ID | Requirement | Acceptance criterion |
|---|---|---|
| F1 | Daily market creation for 7 stocks | Automation creates all strikes before 8:30 ET on trading days and skips holidays. Re-running it is idempotent. |
| F2 | Mint pair | Deposit N USDC → receive N YES + N NO; the vault grows by exactly N USDC |
| F3 | Order book (CLOB) | Price-time priority, 1¢ ticks in [1¢, 99¢], Limit / IOC / FOK, cancel, claim fills. Real-time UI updates |
| F4 | Four trade paths on one book | Buy YES, Sell YES, Buy NO (= mint + sell YES, atomic), Sell NO (= buy YES + merge, atomic). One wallet signature each |
| F5 | Position constraint | The UI blocks buying YES while holding NO (and vice versa) and guides the user to exit first |
| F6 | Oracle settlement | Permissionless `settle_market` reads the Pyth price on-chain and checks feed id, Full verification, publish-time window around the close, and confidence band |
| F7 | Admin override | Admin-only, callable only `≥ 1h` after close, and only if the market is still unsettled |
| F8 | Redemption | One transaction burns the user's YES+NO and pays $1 per winning token. Pairs can be merged for $1 at any time |
| F9 | Pause | Admin pause blocks mint and new orders. Cancel, claim, redeem and settle always stay open, so users can always exit |
| F10 | Portfolio and history | Positions, average entry, mark, realized/unrealized P&L, settled outcomes, redeem button, trade log |
| F11 | Wallet integration | Wallet Standard wallets (Phantom, Solflare, Backpack) on devnet |

### 3.4 Non-functional requirements

| Metric | Target | How we meet it |
|---|---|---|
| Settlement correctness | 100% | Integer-only comparison (`price_micro ≥ strike_micro`), property tests over the price space, and an immutable outcome |
| $1 invariant | Never violated | Payout is a function of the outcome only. Collateral accounting is checked on-chain after every mint/redeem, plus invariant tests |
| Settlement latency | ≤ 10 min after close | The settler polls on-chain state every 30s, so it settles as soon as `close_ts` passes. Retries for 15 min, then alerts |
| Market creation | Before 8:30 ET | Morning job at 8:00 ET with retry/backoff and alert on failure |
| Finality | Sub-second | Solana ~400ms slots. The UI acts on `confirmed` commitment |
| Oracle staleness | ≤ 5 min | Settlement rejects prices whose publish time is more than `max_staleness` (default 300s) from the close |
| Order book updates | Real-time | WebSocket account subscription on the book account (no polling) |

### 3.5 Out of scope (v1)
- Mainnet and real funds (forbidden by the brief for the core submission).
- KYC, compliance and regulatory claims (see `RISKS.md`).
- Fees. The design reserves a separate fee account so the vault invariant stays exact.
- Order-book liquidity incentives or a protocol market maker. A demo market-maker script is provided.
- Token metadata (wallet-visible names). The frontend labels tokens itself.

## 4. Assumptions

1. **Chain: Solana devnet.** The brief prefers it and requires devnet to pass.
2. **Collateral: a devnet USDC-like mint (6 decimals).** The program is mint-agnostic (`config.usdc_mint`). Circle's devnet faucet is rate-limited and behind a captcha, so the demo uses a project-controlled test mint with a faucet route. Production would point at real USDC.
3. **Oracle: Pyth pull oracle (PriceUpdateV2 accounts via the Pyth Solana Receiver).** Pyth's devnet *push* feeds for US equities stopped updating in mid-2026. Since 2026-08-26 Hermes requires an API key, so `PYTH_API_KEY` is an operational prerequisite.
4. **"Closing price" = the last regular-session Pyth print at/around `close_ts`.** It is not the exchange closing-auction print. The difference is documented as a known limitation.
5. **Close time is per market.** It is not hard-coded to 16:00 because NYSE has early-close days at 13:00. The automation reads the session calendar from Pyth's market-hours metadata.
6. **Strike units:** strikes and prices are stored as integer micro-USD (1e-6). Token quantities are whole contracts (0-decimal mints), so all payout math is exact integer math.
7. **One book per strike (YES vs USDC).** NO is never traded directly. It is the inverse view of the same book.
8. **Single admin key on devnet.** Production would use a multisig such as Squads (see journal).

## 5. Success criteria (from the brief)
- The full lifecycle (create → mint → trade → settle → redeem) runs end-to-end on devnet from a script.
- All 4 trade paths work. Position constraints are enforced in the UI.
- The $1 invariant is never violated, which the tests demonstrate.
- Unit, integration, invariant and frontend tests pass, and the results are committed.
- Docs: architecture rationale, trade-offs, risks, deployment guide and AI usage log.

## 6. Deliverables
Source code · Technical documentation · Demo video · Deployment guide · Test results · AI usage log.
