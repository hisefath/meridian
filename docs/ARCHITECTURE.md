# Meridian — Architecture, Concepts and Trade-offs

This document explains *why* the system looks the way it does. The *what* is in [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) and the requirements are in [`PRD.md`](PRD.md).

---

## 1. Design principles

1. **The program is the only trusted component.** Custody, minting, matching, the trading halt at close, settlement validation and redemption are all enforced on-chain. The frontend and automation are conveniences. Either could be malicious or down without breaking an invariant.
2. **Integers only on the money path.** Prices are cents, quantities are whole contracts, and USDC, strikes and oracle prices are fixed-point integers. A binary payoff that turns on `close ≥ strike` cannot afford a float rounding to the wrong side.
3. **Liveness without trust.** Settlement is permissionless and oracle-validated. If our server dies at 3:59 PM, anyone can settle at 4:00. The admin override exists, but it is delayed so that the oracle path always gets first claim.
4. **Users can always exit.** Pause stops new risk (mint, new orders). It never blocks cancel, claim, redeem or settle.
5. **Few moving parts.** No indexer, no database and no message queue. The chain is the database. The automation is stateless and re-derives what to do from on-chain state every tick.
6. **The chain's clock is the only clock.** The program enforces the close, the settlement window and the override delay against `Clock::unix_timestamp`, so the automation and scripts decide using `getBlockTime` too, never the host clock. In development Docker's VM clock ran 9 minutes fast and the local validator lagged by about 20s. Wall-clock logic would have sent transactions the program correctly rejected.

---

## 2. Concepts

### 2.1 Binary outcome contract and the $1 invariant
A contract is a pair of SPL tokens (YES, NO) backed by exactly $1 of USDC per pair in a program-owned vault.

- `mint_pair(n)`: deposit `n` USDC, receive `n` YES and `n` NO. This is the **only** path that mints, because the mint authority is the Market PDA.
- `redeem_pair(n)`: burn `n` YES and `n` NO, receive `n` USDC (any time).
- `redeem()` after settlement: burn everything and receive `$1 × winning tokens`.

Because the payout is `outcome ? (1,0) : (0,1)`, **YES payout + NO payout = $1 for every possible price**. This holds by construction, and it is also tested by property tests over the full price range.

### 2.2 Why one book (YES/USDC) serves four actions
YES + NO = $1, so **holding NO is economically the same as being short YES** (fully collateralised). That gives:

| User intent | Book action | Mechanics |
|---|---|---|
| Buy YES | take asks | `place_order(Bid)` |
| Sell YES | take bids | `place_order(Ask)` |
| Buy NO at c | sell YES at 1−c | `mint_pair` + `place_order(Ask)` in **one tx** |
| Sell NO at c | buy YES at 1−c, then merge | `place_order(Bid)` + `redeem_pair` in **one tx** |

A second NO book would split liquidity in half and open arbitrage between two books that must always sum to $1. One book keeps the YES price as a single probability estimate.

### 2.3 The CLOB (central limit order book)
The book is a fixed array of 64 order slots in a **zero-copy** account. The program reads it in place without Borsh-deserializing 4 KB on every instruction. Each slot holds `{owner, side, price¢, qty, seq, claimable}`.

- **Matching:** price-time priority. To find the best opposite order the program does a linear scan (best price, then lowest `seq`). Measured: a taker sweeping 20 makers on a full 64-slot book uses **49.9k CU** (~2k per fill, 25% of the default budget). See `docs/TEST_RESULTS.md`.
- **Order types:** `Limit` (the remainder rests), `IOC` (the remainder is cancelled), `FOK` (all or revert). UI market orders are FOK with a slippage-bounded limit price.
- **Escrow:** a resting bid escrows `qty × price` USDC and a resting ask escrows `qty` YES. Both go into book escrow accounts that are separate from the vault.
- **Taker vs maker settlement:** the taker is paid immediately, because their token accounts are in the transaction. Makers are *not* in the taker's transaction, so their proceeds accrue to the slot's `claimable` and they pull them later with `claim_fills`. This is the standard non-custodial CLOB pattern (OpenBook's "settle funds", Phoenix's free balances). It keeps a taker's account list fixed and small no matter how many makers they hit.
- **Halts:** `place_order` requires `!paused && outcome == Open && now < close_ts − max_staleness`. The book closes when the oracle settlement window opens, because any print inside that window is public the moment it's published. **An external CLOB cannot enforce this.** On Phoenix/OpenBook, YES tokens would keep trading through the close while the settling price is public.
- **Dead-slot crank:** a fully filled slot keeps its `claimable` until claimed, so `crank_claim` lets *anyone* push those proceeds to the owner's ATA and free the slot. This closes a griefing vector found in review (64 one-cent self-trades filling the book).

### 2.4 Oracle: Pyth pull model
Pyth publishes signed price messages off-chain on Hermes. To use one on Solana, you post it through the **Pyth Solana Receiver**, which verifies the Wormhole guardian signatures and writes a `PriceUpdateV2` account. Our program reads that account during `settle_market`.

- **Why pull, not push:** Pyth's sponsored push feeds for US equities on Solana stopped updating in mid-2026; we checked this on-chain on 2026-10-06. The pull model also lets the settler pick the update **at the close**, rather than whatever is latest.
- **Why the window is around `close_ts`, not around "now":** a staleness check relative to `now` would reject the true closing price if settlement ran at 16:05, which the brief allows. We want *the* close, so the check is `|publish_time − close_ts| ≤ max_staleness`.
- **Confidence:** Pyth reports a confidence interval. We reject when `conf/price > max_conf_bps`, for example during a halt or when publishers are thin. Settling on a price Pyth itself is unsure about is how you pay the wrong side.
- **Parsing:** we parse the 134-byte `PriceUpdateV2` layout by hand (about 30 lines, with an owner check and a discriminator check) instead of pulling in `pyth-solana-receiver-sdk`. That crate pins its own Anchor/Solana versions, and version skew between Anchor and oracle SDKs is the most common Solana build break. The brief also asks us to avoid unnecessary third-party abstractions.

### 2.5 PDAs and authority
Every market account is a PDA derived from `(ticker, close_ts, strike)`. The Market PDA signs for its mints, vault and escrows, and no private key exists for any of them. Re-running the morning job is idempotent because the address of a strike that already exists is known, so the job skips it.

### 2.6 Collateral accounting vs. raw balances
The brief says "vault balance = $1 × pairs minted (exact)". A naive on-chain `vault.amount == supply × $1` check is a **denial-of-service bug**: anyone can transfer 1 µUSDC into any token account, after which every mint and redeem would fail forever. SPL Token also lets holders burn their own tokens without the program. So the program:
- keeps exact **internal accounting** (`market.collateral`, updated only by mint/redeem),
- asserts after every mint/redeem that `vault.amount ≥ collateral` (solvency) and `collateral ≥ supply × $1` for each live token (full backing),
- and the tests assert **exact equality** (`vault == collateral == supply × $1`) in every scenario that has no donations or self-burns.

---

## 3. Major decisions and trade-offs

### 3.1 Chain: Solana (devnet)
| Option | Pros | Cons |
|---|---|---|
| **Solana** ✅ | ~400 ms slots and sub-second confirmation; cheap enough to match orders on-chain; native CLOB culture (Phoenix, OpenBook); preferred by the brief | Account-size and compute limits shape the design; devnet SOL is rate-limited |
| EVM L2 (Arbitrum/Base) | Solidity tooling; deep liquidity | 250 ms–2 s blocks via a centralised sequencer; on-chain matching is gas-heavy, which pushes you toward off-chain books; the brief warns about latency |
| HyperLiquid | Fastest real CLOB | HIP-3 lets builders deploy *perp* markets (with a large HYPE stake), not custom fully-collateralised binary instruments with our settlement rule. HyperEVM could host the vault logic, but the native book can't enforce our halt or settlement semantics. Not feasible for v1 |

### 3.2 Order book: build a minimal on-chain CLOB vs. integrate Phoenix/OpenBook/Manifest
**Decision: build it in the Meridian program.**

| | Own minimal CLOB ✅ | External CLOB |
|---|---|---|
| Halt at close / pause | One `require!` | Not enforceable; the external market keeps trading after 4 PM |
| Atomic Buy NO / Sell NO | Same program, trivially composable | Possible via tx composition, but escrow and seat models differ per venue |
| Devnet availability | We deploy it ourselves | Devnet deployments of third-party CLOBs are often stale or missing, and local tests must clone them |
| Rent per market | ~0.03 SOL book (we size it) | Phoenix/OpenBook markets are much larger, which matters at ~40 markets/day |
| Battle-testing | ❌ Ours is new | ✅ Audited, used in production |
| Performance | O(N) scan per fill, 64 slots | Crit-bit / red-black trees, thousands of orders |
| Composability | ❌ Aggregators won't route to it | ✅ Jupiter etc. |

The brief calls this "more ambitious, but demonstrates deeper understanding". For a firm that started as an options market maker, owning the matching semantics is the point. **Upgrade path:** keep the Meridian program for vaults and settlement, and swap the matching module for a Manifest/Phoenix integration once those are stable on the target cluster, adding a market-status CPI to enforce the halt.

### 3.3 Settlement: permissionless + windowed, vs. permissioned
| | Permissionless ✅ | Admin/keeper only |
|---|---|---|
| Liveness | Anyone can settle; no single point of failure | Down keeper = unsettled markets |
| Manipulation | A settler can *choose* any valid update within the window. Bounded by `max_staleness` (300s default per the brief; recommend ≤30s in production) | The operator chooses (trusted) |

We take liveness and bound the choice. A production upgrade is a two-phase *propose → challenge → finalize* flow, where a later in-window update can replace an earlier one before finality.

### 3.4 Order book capacity: 64 slots
Accounts created via CPI are capped at 10 KB, and rent scales with size. 64 slots × 64 B ≈ 4.2 KB ≈ 0.03 SOL rent per market. That is plenty for demo liquidity. The known ceiling is that an attacker can fill the book with 64 one-contract orders. Each costs real escrow, but it is a griefing vector. Upgrade path: a minimum order notional, eviction of the worst-priced order (Phoenix does this), or a larger account allocated in a separate transaction.

### 3.5 Maker proceeds: claimable balances vs. direct transfer
Direct transfer would make every taker transaction carry every matched maker's token account. That is non-deterministic: the client has to predict the matches, the transaction size limit caps fills, and a maker closing their ATA could block matching. Claimable balances make the taker's account list constant. The cost is that makers click "Claim". The UI bundles the claim into the maker's next transaction.

### 3.6 Position constraint: frontend, not chain
The brief puts this in the frontend, and that is correct. Market makers *must* hold YES and NO at once (mint, then quote one side), so a chain rule would break market making. The UI reads balances and blocks Buy YES while NO is held (and vice versa), offering "Sell NO first".

### 3.7 Collateral mint: test USDC on devnet
The program is mint-agnostic (`config.usdc_mint`). Circle's devnet faucet is captcha-gated and rate-limited, which makes a scripted, reproducible multi-user lifecycle impossible. So devnet uses a 6-decimal test mint plus a `/api/faucet` route. Mainnet would set `usdc_mint = EPjFWdd5…Dt1v`, with no code change.

### 3.8 Tokens: 0-decimal classic SPL Token
One token is one contract, so payouts are `count × 1,000,000` µUSDC with no fractional contracts and no rounding. Classic SPL Token works with every wallet. Token-2022 adds nothing here, because no extension prevents holders burning their own tokens.

### 3.9 Testing: LiteSVM + property tests, not `solana-test-validator`
- **Pure Rust unit and property tests** (`cargo test` + `proptest`) cover the matching engine, payout math and price normalisation. They run in milliseconds over thousands of random cases.
- **LiteSVM** runs the compiled `.so` in-process from TypeScript. It can **warp the clock** (to test the override delay and the close halt) and **inject Pyth `PriceUpdateV2` accounts** (stale, wide-confidence, wrong-feed, partial-verification). That is not possible against devnet and is slow on a local validator. The tests use the same `sdk/` instruction builders as the app.
- **Live-network run** (`scripts/lifecycle.ts`) against [Surfpool](https://github.com/txtx/surfpool), a LiteSVM-backed local validator with real RPC and WebSocket, and against devnet. It exercises the exact transactions, RPC behaviour and clocks the product sees. It caught four bugs that the in-process tests could not see (ESM interop, a dependency conflict, clock skew, a server-only env default).
- **Browser end-to-end:** the Next.js app against Surfpool with a dev-only burner wallet. All four trade paths, the position constraint, P&L, history, and settle → redeem.

### 3.10 Automation: state-driven loop, not cron-at-4:05
The settler wakes every 30s and settles any `Open` market with `close_ts ≤ now`. That handles early-close days (13:00) and restarts after crashes, and it is naturally idempotent. A cron firing "at 16:05" would need a holiday calendar, would miss early closes, and would silently skip a day if the process was down at that minute. The morning job does use a clock (08:00 ET), but it is idempotent and reads the trading calendar from Pyth's market-hours metadata instead of a hard-coded holiday list.

### 3.11 Dependencies (each one justified)
| Dependency | Why we need it | Alternative rejected |
|---|---|---|
| `anchor-lang`, `anchor-spl` 0.32.1 | Account validation, PDA/CPI ergonomics, IDL for clients; the brief names Anchor | Native/pinocchio: smaller CU, much more hand-written validation |
| `proptest` (dev) | Property/invariant tests | Hand-rolled random loops |
| `@coral-xyz/anchor` (TS) | IDL-typed instruction builders | Hand-encoding Borsh |
| `@solana/web3.js` v1, `@solana/spl-token` | Anchor's TS client is built on v1 | `@solana/kit`: not supported by Anchor 0.32 |
| `litesvm` 0.8 (dev) | In-process SVM for fast, deterministic tests | `solana-test-validator`: slow, no clock warp |
| `cargo-build-sbf` 4.4 (build) | Compiles the program (`--arch v0`) | The 8.8 GB amd64 `solanafoundation/anchor` image: emulated on Apple Silicon, slow, linker segfaults |
| `@solana/wallet-adapter-unsafe-burner` (dev flag only) | Wallet for local browser E2E | — (never enabled on a real cluster) |
| `@pythnetwork/pyth-solana-receiver` (automation) | Posting/verifying Wormhole VAAs is multi-transaction and non-trivial | Re-implementing guardian verification |
| Next.js, React, `@solana/wallet-adapter-*` | The brief's stack; Wallet Standard auto-detects wallets | — |
| Vitest + Testing Library (dev) | Fast TS-native UI tests | Jest: slower with ESM/TS config |

No database, ORM, state library, UI kit or job queue.

---

## 4. Security notes
- Signer and `has_one` checks on every admin instruction. Token accounts are constrained by mint and owner.
- Checked arithmetic everywhere (`checked_mul`/`checked_add`). `overflow-checks = true` in release.
- The outcome is write-once: settle/override require `outcome == Open`.
- Halt at close is enforced on-chain (no trading on known outcomes).
- Oracle: owner, discriminator, Full verification, feed id, time window and confidence are all checked.
- The PDA bump is stored and reused (canonical bumps only).
- Known limitations are listed in [`RISKS.md`](../RISKS.md).
