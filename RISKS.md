# Risks and Limitations

Meridian is a devnet prototype built for an engineering evaluation. It makes **no regulatory, legal or compliance claims**, uses test funds only, and is not an offer of any financial product.

## Protocol and smart contract
| Risk | Status / mitigation |
|---|---|
| **Unaudited program.** The matching engine, escrow and settlement code is new. | Property tests (512 random books × conservation and no-crossed-book), randomized LiteSVM invariant runs, and unit tests on every instruction. Needs an external audit before any real money is involved. |
| **Order book capacity: 64 resting orders per strike.** It can be griefed by filling the slots with 1-contract orders. | Each slot costs real escrow, and takers can still trade on a full book. Fixes: minimum order size, evict the worst-priced order, or a larger book. |
| **O(N) matching** (linear scan over 64 slots per fill). | ~3k compute units per fill is fine at this size. Use a crit-bit tree or price levels for deeper books. |
| **Permissionless settlement window.** A settler can choose any valid Pyth update within ±`max_staleness` of the close. | Bounded by config (300s default, per the brief). Recommend ≤30s in production, or a propose/challenge/finalize flow. |
| **Pyth's last regular-session print ≠ the exchange's official closing-auction price.** | Documented. Strikes far from the close are unaffected, but a contract within cents of the strike could settle differently from the official close. |
| **Single admin key** (create markets, pause, override after the delay). | The delay gives the oracle path priority. `set_admin` lets you move control to a multisig (e.g. Squads) with no program change. The upgrade authority should move too. |
| **Admin override trusts a human-supplied price.** | Only callable after `close + override_delay`, only on still-unsettled markets, and flagged on-chain (`settled_by_override`). |
| **Config front-running at deploy.** Anyone could call `initialize_config` first on a freshly deployed program. | The deploy script initializes right after deploy. Production fix: require the signer to be the program's upgrade authority. |
| **Holders can burn their own SPL tokens** outside `redeem` (an SPL Token feature). | This only forfeits the holder's claim. The vault can never be under-collateralised (`vault ≥ collateral ≥ supply × $1`, checked on-chain). |
| **Self-trades are allowed.** | Economically neutral (you pay yourself). Add self-trade prevention for wash-trading surveillance. |
| **No fees.** | By design for v1. A fee would go to a separate account so the vault invariant stays exact. |
| **Rent:** ~0.03 SOL per strike for the order book account, never reclaimed. | A `close_book` instruction after settlement, once all orders are withdrawn, would reclaim it. |

## Operations
| Risk | Status / mitigation |
|---|---|
| **Pyth Hermes needs an API key** (since 2026-08-26). Without it there is no oracle settlement and no live prices. | `PYTH_API_KEY` env. Without it the automation falls back to manual `PREV_CLOSES` for strikes and the admin override for settlement (the documented failure path). |
| Automation is a single process. | It is stateless and idempotent, and it reconstructs everything from chain state. Settlement is permissionless, so anyone can settle if it dies. Run under a supervisor with restart (Railway/Fly/systemd). |
| Devnet SOL is rate-limited, and markets cost rent daily. | ~40 strikes × ~0.04 SOL ≈ 1.6 SOL/day. Fund the admin wallet, or reduce `STRIKE_PCTS`. |
| Devnet RPC (`api.devnet.solana.com`) is rate-limited and drops WebSockets under load. | Use a dedicated RPC (Helius/Triton) via `RPC_URL` / `NEXT_PUBLIC_RPC_URL`. |
| Test USDC is a project-controlled mint. | Devnet only. On mainnet `USDC_MINT` would be Circle USDC. The program is mint-agnostic. |

## Product
- History and P&L are reconstructed client-side from the last few hundred transactions per market. A production version needs an indexer.
- Position constraints (no simultaneous YES and NO from the trading UI) are enforced in the frontend, as the brief specifies. The chain allows both because market makers need them.
- There are no trading-hours checks before 9:30 ET on-chain. Pre-open trading has no informational edge against the protocol. The critical halt at the close **is** enforced on-chain.
