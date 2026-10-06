# Test Results

All suites run locally with `make test`, which needs only Docker and Node. The counts below are from the run on **2026-10-06**.

| Suite | Runner | Tests | Result |
|---|---|---|---|
| Program: pure Rust unit and property tests | `cargo test` (toolchain container) | 16 | ✅ 16 passed |
| SDK unit tests | Vitest | 11 | ✅ 11 passed |
| Automation jobs | Vitest | 7 | ✅ 7 passed |
| Program integration: per instruction | Vitest + **LiteSVM** (compiled `.so`) | 24 | ✅ 24 passed |
| Program integration: lifecycle + 4 trade paths | Vitest + LiteSVM | 6 | ✅ 6 passed |
| Program integration: randomized invariants | Vitest + LiteSVM | 3 (× 150 ops) | ✅ 3 passed |
| Frontend UI flows | Vitest + Testing Library (jsdom) | 21 | ✅ 21 passed |
| **Total automated** | | **88** | ✅ **all passing** |
| End-to-end on a live RPC network | `scripts/lifecycle.ts` against Surfpool | full lifecycle | ✅ vault 0, USDC conserved ([log](localnet-lifecycle-run.md)) |
| Manual UI end-to-end (browser + wallet) | Next.js app against Surfpool | 4 trade paths, mint, constraint, P&L, history, settle + redeem | ✅ see below |
| Devnet lifecycle | `make lifecycle-devnet` | — | ⏳ pending devnet SOL (faucet rate-limited); see [DEPLOYMENT.md](DEPLOYMENT.md) |

## What each requirement from the brief is covered by

| Brief requirement | Covered by |
|---|---|
| Unit tests for all core functions | `tests/program.test.ts`: initialize_config, set_admin, set_paused, create_strike_market, add_strike, mint_pair, redeem_pair, place_order, cancel_order, claim_fills, settle_market, admin_settle, redeem. Plus `book.rs` and `oracle.rs` unit tests |
| Settlement: at, above and below the strike | `settle_market (oracle)`: above → YES, below → NO, **exactly at strike → YES**, 1 µUSD below → NO |
| Invariant: YES + NO payout = $1 for all prices | `yes_plus_no_is_one_dollar` (proptest over the whole u64 price/strike space) + `flooring_never_flips_outcome` (oracle exponent conversion never changes an outcome) |
| Vault balance invariant after every mint/redeem | Asserted **on-chain** after every mint/redeem (`check_collateral`). The tests check `vault == collateral == supply × $1` after every step, including 3 × 150 randomized operations, and that a USDC donation can't brick a market |
| Oracle validation: stale, wide confidence, valid | Stale (±301s from close, both sides), confidence 2.01% vs 2.00% limit, wrong feed id, partial Wormhole verification, wrong account owner, before-close, plus the **real devnet PriceUpdateV2 bytes** parsed in `oracle.rs` |
| Admin override with time delay | 1s before the delay → `OverrideTooEarly`; non-admin → `Unauthorized`; flagged `settled_by_override`; cannot override an oracle-settled market |
| Full lifecycle | `lifecycle.test.ts` (LiteSVM) + `scripts/lifecycle.ts` on a live RPC network |
| All 4 trade paths | `four trade paths on one book`: Buy YES/Sell YES, Buy NO (mint + ask, atomic), Buy NO market **reverts entirely** if the YES leg can't fill, Sell NO (bid + merge, atomic), Buy NO limit |
| Multi-user: one mints and quotes, another takes, both redeem | `full lifecycle … (multi-user)`: MM + bull + bear. USDC conserved to the micro-unit, and payouts are exact |
| Frontend: wallet connection | `wallet.test.tsx`: disconnected/connected states, balance, faucet |
| Frontend: order placement and signing | `tradepanel.test.tsx` (intent → instructions: Buy NO = `mintPair`+`placeOrder`, Sell NO = `placeOrder`+`redeemPair`) + `wallet.test.tsx` (one `VersionedTransaction`, one wallet signature, program error surfaced) |
| Frontend: real-time oracle price display | `prices.test.tsx`: polls the Hermes proxy and re-renders on price change; degrades when the key is missing |
| Frontend: order book, both views + updates | `orderbook.test.tsx`: YES levels, mirrored NO view, re-render on account change |
| Frontend: position constraints | `tradepanel.test.tsx`: Buy YES blocked while holding NO (and vice versa), with guidance |
| Frontend: portfolio and P&L | `portfolio.test.tsx`: average entry, unrealized/realized, NO-via-mint pricing |
| Frontend: settlement display and redeem | `portfolio.test.tsx`: outcome + settle price, `Redeem $X` with the exact payout, $0 for losers, merge pairs |

## Live-network verification (Surfpool, 2026-10-06)
Surfpool is a LiteSVM-based local Solana network with a real JSON-RPC and WebSocket API. The program was deployed with the same `solana program deploy` command the devnet target uses.

1. `scripts/setup-devnet.ts`: created the test-USDC mint and initialized Config.
2. `scripts/lifecycle.ts`: create → fund → mint → MM quotes → Buy YES, Sell YES, Buy NO, Sell NO → close → admin override → claim/cancel → redeem. **Vault 0, USDC conserved, trader P&L +$1.35 matching the hand calculation.** Transcript: [localnet-lifecycle-run.md](localnet-lifecycle-run.md).
3. `automation morning`: read the real trading calendar from Pyth (close 16:00 ET), and created **45 markets** for 7 stocks with de-duplicated strikes.
4. Browser UI driven end to end with a wallet (dev-only burner adapter):
   - faucet → **Buy YES 10** (paid $6.10 at 61¢; the book updated live over WebSocket)
   - **Buy NO blocked** while holding YES ("Sell your YES position before buying NO")
   - **Sell YES 10** (+$5.70) → **Buy NO 10** (one tx: mint + sell; −$4.60) → **Sell NO 10** (one tx: buy + merge; +$3.60). Balances reconciled to the cent
   - Portfolio: entry 30.0¢, mark 29.5¢, unrealized −$0.03, realized −$0.16 after a partial exit. History lists each fill with a tx link
   - Mint pairs → close → settlement → Redeem (see the settlement section below)

## Bugs found by the tests (and fixed)
| Found by | Bug | Fix |
|---|---|---|
| LiteSVM (all tests) | `cargo-build-sbf` 4.4 defaults to **SBPF v3**, which LiteSVM and mainnet-compatible loaders reject | Build with `--arch v0` |
| Rust compile | Seeds array type mismatch, missing `bytemuck`, anchor-spl features | Fixed in the program |
| Lifecycle test | Float expectation (`999.6 × 1e6`) | Integer expectations. The program was right |
| Script on live RPC | Override sent using **wall-clock time**, but the program uses the chain clock (Surfpool lagged 22s; Docker's VM ran 9 min fast) | All automation decisions use `chainNow()` (`getBlockTime`) |
| Script on live RPC | Anchor's `BN` re-export is invisible to Node's ESM loader (Vitest hid it) | Import `bn.js` directly |
| Script on live RPC | `jito-ts` (via Pyth utils) pins web3.js 1.77, which breaks with rpc-websockets 7.11 | npm override to the top-level web3.js |
| Browser E2E | Faucet route crashed when `NEXT_PUBLIC_USDC_MINT` was unset on the server; Nav crashed on a non-JSON error | Shared `lib/config.ts`, plus a guarded fetch |
| Browser E2E | Strike cards only showed quotes for the selected strike | `useBooks`: every book in one `getMultipleAccountsInfo` |
| Browser E2E | Closed-out positions vanished from Portfolio (realized P&L hidden) | Markets found from the wallet's own signatures (`touchedMarkets`) |
| Browser E2E | Nav overflowed at 375px | Wrapping nav |
| jsdom tests | `instanceof Uint8Array` across realms | Test setup restores Node's constructor |

## Reproduce
```bash
make toolchain build test         # program + all automated suites
npm test                          # TS suites only (needs target/deploy/meridian.so)
```
