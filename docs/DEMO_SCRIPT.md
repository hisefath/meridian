# Demo Video Script (~6 minutes)

**Record during US market hours (9:30–16:00 ET, Mon–Fri)** so the Pyth equity feed is live and settlement goes through the real oracle. Prerequisites: `.env` has `PYTH_API_KEY`, the admin wallet holds devnet SOL, `make deploy-devnet setup-devnet` is done, and the app runs (`make dev`). Use two browser profiles with Phantom on devnet: **MM** and **Trader**.

| # | Time | Show | Say |
|---|---|---|---|
| 1 | 0:00 | README, then the system-design diagram | "Meridian: same-day binary contracts on MAG7 closes. YES pays $1 if the stock closes at or above the strike, NO pays $1 otherwise. YES + NO = $1 always. Three parts: an Anchor program that holds the money and the order book, an automation service, and a Next.js app." |
| 2 | 0:40 | Terminal: `make demo-market ARGS="--ticker META --strike <ATM> --minutes 12"` | "The morning job creates ±3/6/9% strikes at 8 AM ET. For the demo I'm adding an intraday strike that closes in 12 minutes. `close_ts` is per market, which is also how we handle 1 PM early closes." |
| 3 | 1:10 | Landing → Markets → META | "Prices are live from Pyth. Each card shows active contracts and the countdown to the close." |
| 4 | 1:30 | MM profile: Get test USDC → Mint 50 pairs → post Ask YES 20 @ 60 and Bid YES 20 @ 55 (Sell YES limit / Buy YES limit) | "Minting deposits exactly $1 per pair into a program-owned vault. The market maker now quotes the single YES book." |
| 5 | 2:20 | Trader profile: show **both** book views | "One on-chain book, two perspectives. The NO ask is 100 minus the best YES bid, so 45¢ here." |
| 6 | 2:40 | Trader: Buy YES 5 (market) → wallet prompt → portfolio | "One signature. The payoff line says exactly what you pay and win." |
| 7 | 3:05 | Trader tries Buy NO → blocked message | "Position constraint: you can't hold both sides from the trading UI, so it tells me to sell YES first." |
| 8 | 3:20 | Sell YES 5 → Buy NO 4 → Sell NO 1 | "Buy NO is mint-a-pair plus sell-the-YES in ONE atomic transaction, fill-or-kill. Sell NO is buy-YES plus merge-the-pair back into $1." |
| 9 | 4:00 | History page → explorer link for the Buy NO tx | "Every action is an on-chain event. Here you can see both instructions in one transaction." |
| 10 | 4:20 | Wait for the countdown → try to trade → "Market is closed" | "At close_ts the **program** rejects orders and mints. It isn't a UI rule. After the close, nobody can trade on a known outcome." |
| 11 | 4:40 | Automation logs: `settled 1 META market(s) at $…` | "The settler posts the Pyth price at the close and calls the permissionless settle_market. On-chain we check the receiver owner, full Wormhole verification, the feed id, the publish time within 5 minutes of the close, and the confidence band." |
| 12 | 5:10 | Portfolio: outcome + Redeem → USDC balance | "Winners burn for $1, losers for $0, in one transaction. Unredeemed tokens stay redeemable forever." |
| 13 | 5:30 | Terminal: `make test` summary (or TEST_RESULTS.md) | "Tests: Rust property tests for matching conservation and the $1 payout over all prices, LiteSVM integration for every instruction, all four trade paths, oracle edge cases, the override delay, and randomized invariant runs where the vault always equals $1 × pairs." |
| 14 | 5:50 | ARCHITECTURE.md trade-off table | "Main trade-off: I built the CLOB inside the program instead of using Phoenix, because an external venue can't enforce the 4 PM halt. Known limits are in RISKS.md." |

**Fallback without a Pyth key:** run `make lifecycle-devnet`. It settles through the admin override after the delay (900s on devnet) and writes `docs/devnet-lifecycle-run.md` with explorer links you can show instead of steps 11–12.
