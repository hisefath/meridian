# Devnet lifecycle run — 2026-10-06T06:15:42.447Z

Program `2rnq72LPCH1aAGKvJrFU6YWAy6XCQh2ERofPhuqA7YCG` · RPC http://host.docker.internal:8899

## 1. Create market "META ≥ $680" closing 2026-10-06T06:17:41.000Z
- add_strike → market `H6gFGxM4KQQLXXDRwBQUapWiMNHBDZUZG4yvyeY6eSwF` — [tx](https://explorer.solana.com/tx/FJhBfDh3r9jQis5oWyodn5eVW7AzsPY1JMuAjDbayEzZ52cbq2ogBQ3L75iB2WeXoYamPLZrdn6h2cDt8P5gwPQ?cluster=custom)
## 2. Fund a market maker and a trader (SOL for fees + test USDC)
- fund MM J3fkbPTU… with 100 test USDC — [tx](https://explorer.solana.com/tx/3zXarpyk5vf8pViJPFfoTCPCNjt561M4aTLt19SLfA7hfn41Niy6Uq9Dm77eYhkcfQdLLCXu7YNT19EQn22fPL1o?cluster=custom)
- fund trader E5M7AVNL… with 100 test USDC — [tx](https://explorer.solana.com/tx/65BzxtzxYNnkakJz3x1kPXQQt5Gq5KEs6zeBXACsHpG8uDjSxKdNgd5maGRgMAXsEm2V73swNEqLSuyWLY9tEr9?cluster=custom)
## 3. Market maker mints pairs and quotes YES 55 / 60
- MM mint_pair ×40 ($40 into the vault) — [tx](https://explorer.solana.com/tx/qtgD7gNNkHdUjpQDBwn851rp2EE4akpSbPuzQURA6JbdMoaDYefXcXQuBwQozUTJEfrvjWD2yQdxDLEEAx83GJx?cluster=custom)
- MM ask YES 20 @ 60¢ — [tx](https://explorer.solana.com/tx/57X3zgp548AQvWVEW6nBjRFqQev4WN2NrY5xxRi3Z7DFALsu4i4TgGVvvNpcSmRLyRxHsdfLsYPSHBh5MUh8VrtE?cluster=custom)
- MM bid YES 20 @ 55¢ — [tx](https://explorer.solana.com/tx/5xcTghME6hbxZBTq7hj5Ej71iZFZq3Zo91b6PG83gVNQkFwNEPPaR8jQMfshZpwUQFhLmLeTuvXLaBa4AsqxFapU?cluster=custom)
## 4. Trader runs all four trade paths (each is ONE transaction / signature)
- Buy YES ×5 (market, ≤ 60¢) — [tx](https://explorer.solana.com/tx/63W6tKi8gpSUnrD27TKcLQGuB8D323g6dbBfCTx63JWtDVJBq5hpCnsXFPQcydCMwU3cNBUxohCu9rbbnhw7LaNJ?cluster=custom)
- Sell YES ×2 (market, ≥ 55¢) — [tx](https://explorer.solana.com/tx/eh8BqVmGAX1SNAFhrrj3eJCNcvMFWsGK7aFX6LCQ1psEnRkMUKXLuEe8rMKH8efmWrCiwUSwrJrprrBTQJS2k52?cluster=custom)
- Sell YES ×3 to flatten — [tx](https://explorer.solana.com/tx/4BQqAqGFCwGNZ1ijQwJYanQqLbsHfDjzuSoZLAtocUpDfTkUtWLhf4qEGZK8HFWgJ9Esb2swRkvF6NVkvCZbpSyb?cluster=custom)
- Buy NO ×4 (mint pair + sell YES @ 55 → NO costs 45¢) — [tx](https://explorer.solana.com/tx/3n2ciHXTvAqvuN2mkTZ7vNHpGUp95H4t7YoBNVzBBupHCsqHQDYZS4ivvvAxcmfQA8T7iTirB2vVhPBg1fcDwabV?cluster=custom)
- Sell NO ×1 (buy YES @ 60 + merge pair → +40¢) — [tx](https://explorer.solana.com/tx/d32y2VWKAer2q431fp8rCT6wediXZBwBBrnyMtjuwtuPzJyJn94Fpqr96cgqXtvUKd6tfqSQGh7FYPFeHZtfpyY?cluster=custom)
- trader now holds 0 YES / 3 NO
## 5. Wait for close (2 min). Orders halted on-chain at close_ts − max_staleness; settlement opens at close_ts
## 6. Settle
- no PYTH_API_KEY: oracle path unavailable → admin override unlocks at 2026-10-06T06:18:41.000Z
- admin_settle at $679 — [tx](https://explorer.solana.com/tx/3BA659PY7DefwRmkhX9czGfCayjfZF2LxSuczzWowvMxpmfFDxzEFPTHKNYD3puLjczFQCjpKUvJi366d2c3Ghpp?cluster=custom)
- outcome: **no** at $679 (override: true)
## 7. Makers withdraw, everyone redeems
- MM claim_fills — [tx](https://explorer.solana.com/tx/66ssrwV4BZg28Bfo9ncHx2cZ7Bi9BbvWgdxGhF4MB61hWwQ4NFtGWAN3h7kjgXvB3Fqm3NX2CCwVC5tFnejTkXa4?cluster=custom)
- MM cancel order #0 — [tx](https://explorer.solana.com/tx/2pN6XJC2LkKVv7pj2hrj1JkCFLMb2rNUUMgE3htorvCYXAZFU53boW4kxZsLpbRwAXEXmaaVzrd1zMa9Thfyiz2i?cluster=custom)
- MM cancel order #1 — [tx](https://explorer.solana.com/tx/4phZ3iBwmahk8L4cRheSzDnFUqZ5yEyuUmNu22JgK9G1n2EqN9KFs4UfKnGwydh1i1BRwkz4fWTW2Q2ATGivmYvN?cluster=custom)
- MM redeem — [tx](https://explorer.solana.com/tx/2YT7jYRDHMPkKTHi5nfHfn9WWKovyUb1kEASfASz4KQZSuAYMnFRC169spD4CKPiWjC8phRvRASABCnWX45EBm6K?cluster=custom)
- trader redeem — [tx](https://explorer.solana.com/tx/2YgMvfEeRdJHvgWZQgfugLLkw3KTryaLkksJfrd6T5R755VH9BZwxm4Tz5Dx8EbbYSckGgNzCQ88Ywj7U4CrK6BJ?cluster=custom)
## 8. Invariants
- vault balance: 0 (collateral 0) — must be 0
- USDC conserved between the two users: yes (MM -1.35, trader +1.35)
