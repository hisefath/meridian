# Deployment Guide

Everything runs from the repo root with **Docker** and **Node 22+**. No local Rust or Solana toolchain is needed. The program toolchain image (`docker/toolchain.Dockerfile`) compiles `cargo-build-sbf` and `anchor-cli` natively for your CPU, so Apple Silicon builds don't run under x86 emulation.

## 0. Prerequisites
| Need | Why |
|---|---|
| Docker Desktop (≈4 GB free inside its VM) | Builds the program and runs the automation/scripts |
| Node 22+ and npm | Frontend, SDK, tests |
| A funded **devnet** keypair (~5 SOL) | Program deploy (~3 SOL rent, refunded on close) + market rent |
| *(optional)* Pyth API key | Oracle settlement and live prices. Hermes has required a key since 2026-08-26: https://pythdata.app/signup |

## 1. Configure
```bash
cp .env.example .env          # then edit: PYTH_API_KEY, keys, RPC
```
Keys live in `keys/` (gitignored). The repo expects:
- `keys/meridian-program.json`, the program id keypair. Generate a new one for your own deployment, then run `anchor keys sync` inside the toolchain image (see §6).
- `keys/admin.json` is the upgrade authority, the config admin and the automation signer. It is also the test-USDC mint authority.
- `keys/usdc-mint.json` is the test-USDC mint address. `keys/mm.json` and `keys/trader.json` are the demo users for the lifecycle script.

```bash
# generate any missing keypair with the toolchain image
docker run --rm -v "$PWD/keys":/keys meridian-toolchain solana-keygen new -s --no-bip39-passphrase -o /keys/admin.json
```

## 2. Build
```bash
make toolchain     # one-time: builds the meridian-toolchain image (~10 min)
make build         # anchor build → target/deploy/meridian.so + IDL, copies the IDL into sdk/
```

## 3. Test
```bash
make test          # cargo unit/property tests + LiteSVM integration + automation + frontend tests
```

## 4. Deploy to devnet
```bash
make deploy-devnet     # solana program deploy --program-id keys/meridian-program.json (admin = upgrade authority)
make setup-devnet      # creates the test-USDC mint and initializes Config (idempotent)
```
`setup-devnet` reads `MAX_STALENESS_SECS`, `MAX_CONF_BPS` and `OVERRIDE_DELAY_SECS` from `.env`. The on-chain minimum override delay is 60s. The devnet deployment uses 900s so the override unlocks exactly when the settler's 15-minute retry window gives up.

## 5. Run the daily automation
```bash
make automation        # docker image running `automation/src/index.ts run`
```
- **08:00 ET** (`MORNING_ET`): checks Pyth's market-hours calendar (holidays and early closes). It reads each stock's previous close, computes strikes (±3/6/9% + ATM, rounded to $10, de-duplicated) and creates any missing markets. The run is idempotent.
- **Every 30s**: settles every open market whose `close_ts` has passed, using one posted Pyth update per ticker. Oracle failures are retried for 15 min, then it raises a webhook alert asking for an admin override.

Host it anywhere that runs a container with restart-on-failure (Railway, Fly.io, ECS, a VM with systemd). It needs `.env` values and the admin keypair (inline JSON in `ADMIN_KEYPAIR` works for PaaS secrets). It is stateless.

Manual operations:
```bash
make demo-market ARGS="--ticker META --strike 680 --minutes 10"   # intraday add_strike closing soon
docker run --rm --env-file .env -v "$PWD/keys":/app/keys:ro meridian-automation \
  npx tsx automation/src/index.ts override --market <MARKET_PUBKEY> --price 683.42   # after close + delay
```

## 6. Full lifecycle on devnet (proof of deployment)
```bash
make lifecycle-devnet
```
This creates a market closing in `CLOSE_IN_MINUTES`, funds a market maker and a trader, then runs mint, quotes, Buy YES, Sell YES, Buy NO and Sell NO. It waits for the close, settles (Pyth if `PYTH_API_KEY` is set, otherwise the admin override after the delay), withdraws and redeems everything, and checks that the vault is empty and USDC was conserved. The transcript with explorer links is written to `docs/devnet-lifecycle-run.md`.

> To settle through Pyth on devnet, run it during US market hours (9:30–16:00 ET, Mon–Fri). Outside the session the equity feed is not publishing and the update at `close_ts` doesn't exist.

## 7. Frontend
```bash
make dev           # npm install + next dev on http://localhost:3000 (devnet)
```
Production build: `npm run build -w app && npm start -w app` (or deploy `app/` to Vercel). Server-side env:
`PYTH_API_KEY` for the `/api/prices` Hermes proxy, and `FAUCET_KEYPAIR` for `/api/faucet`, which mints 100 test USDC and drips 0.05 SOL. The faucet refuses to run unless the RPC is devnet or localhost. Browser env: `NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_USDC_MINT`.

## 8. Redeploying under your own program id
```bash
docker run --rm -v "$PWD/keys":/keys meridian-toolchain solana-keygen new -s --no-bip39-passphrase -o /keys/meridian-program.json
# put the new pubkey in programs/meridian/src/lib.rs (declare_id!) and Anchor.toml, then:
make build deploy-devnet setup-devnet
```
The SDK reads the program id from the regenerated IDL, so the frontend and automation pick it up with no code change.

## Mainnet checklist (not done; out of scope for the brief)
Audit · multisig admin and upgrade authority · `USDC_MINT` = Circle USDC · dedicated RPC · paid Pyth plan · alerting to on-call · `max_staleness_secs` ≤ 30 · `close_book` rent reclaim · indexer for history.
