# Devnet lifecycle run — 2026-10-06T05:30:51.434Z

Program `2rnq72LPCH1aAGKvJrFU6YWAy6XCQh2ERofPhuqA7YCG` · RPC http://host.docker.internal:8899

## 1. Create market "META ≥ $680" closing 2026-10-06T05:32:51.000Z
- add_strike → market `ETyhBjJizqKPsVnRhtUvGqUAYeXaou8MM4JrZYtvb4CC` — [tx](https://explorer.solana.com/tx/2tfqhW5G4zLpEnsyxh74N57hXNARFF1ZDoWPU8k1aZrnyARqHmR7x4QP9QGuq4kPJ3Y3jccy9drTg86eDt7ED5rf?cluster=custom)
## 2. Fund a market maker and a trader (SOL for fees + test USDC)
- fund MM J3fkbPTU… with 100 test USDC — [tx](https://explorer.solana.com/tx/3LtEUD24zioq6TmhRw6d8h8bvdqix6ctr9psXbzViiwGgJNsLsKUjbHNyeKdKZKVUh8sqYZ8zKcpHN4bwGGwzHwa?cluster=custom)
- fund trader E5M7AVNL… with 100 test USDC — [tx](https://explorer.solana.com/tx/2Qod4uN85SeonwP72JeET86YgJScH2qaaPRNomCpv4MhyX3Wj7f57DNpSQsBqH2SHG2Z5ueyfUpiYwUCUyuZnxKu?cluster=custom)
## 3. Market maker mints pairs and quotes YES 55 / 60
- MM mint_pair ×40 ($40 into the vault) — [tx](https://explorer.solana.com/tx/4amAapX6zFbCHa86i6kxKtCP9ZbvtSRTqFL1fTDjM33ML7VpQrZaGWjaodx13RVbxJn4K7aUuHQ8di9r6J1RP8sA?cluster=custom)
- MM ask YES 20 @ 60¢ — [tx](https://explorer.solana.com/tx/5gyw54RjpdG2irQ3VsZj4zDfRjpGnthQcKSnwQFKBTn15beQg2F4A5uyx5a1RMYzWCeJ1BeVuCVuqKfYhXh5Tnub?cluster=custom)
- MM bid YES 20 @ 55¢ — [tx](https://explorer.solana.com/tx/3HvLSpU3FXC3ZGZLm5jCU6D8ocW7srLoG9htQMUZNUth4ALSmJ7EkeqSAw7gZYZtVH2tTHQuALfhgunP2qh6Nk4s?cluster=custom)
## 4. Trader runs all four trade paths (each is ONE transaction / signature)
- Buy YES ×5 (market, ≤ 60¢) — [tx](https://explorer.solana.com/tx/4UKDEUNjd4pbd24nzG9d7RtbTATipSp1C56PKYthmK7zHoYEDQSjX4STtMbYZtx5gdF9aH9vVaABCsTvhSrGaoW4?cluster=custom)
- Sell YES ×2 (market, ≥ 55¢) — [tx](https://explorer.solana.com/tx/3bKTcDRvcqLFTz3nqtx8kuPmopkaacDyXSt8J7DQ9G76apGB3DhzcjLGH3ngaGFCUPxmqrwS8veBcHJxSguU7i4v?cluster=custom)
- Sell YES ×3 to flatten — [tx](https://explorer.solana.com/tx/3BeGudUy8Fyh4xmh7AR2RDjfCfvmy1HqaYoKgbDs7UqMUeCRGtefG2y8pms1d9ukimrgsBatTXB7A3bxF9x2EuQB?cluster=custom)
- Buy NO ×4 (mint pair + sell YES @ 55 → NO costs 45¢) — [tx](https://explorer.solana.com/tx/2uFNwex9LE9KnqCAKUvcPvHEi3PtZzc5KtLmTwyCrhNAu6UbxWtuDZKm41Z5CPFbgKKFt5Z2NyFfhTVkrG2oBUkr?cluster=custom)
- Sell NO ×1 (buy YES @ 60 + merge pair → +40¢) — [tx](https://explorer.solana.com/tx/36fpViAfnkApnHNbbWNKVrsJaaEArX3JEMpeYgsQ5Xv3fWU3KRYjduqojVb4qbnMNoP9RHXczktcCJjLwwR9cBrN?cluster=custom)
- trader now holds 0 YES / 3 NO
## 5. Wait for close (2 min) — trading halts on-chain at close_ts
## 6. Settle
- no PYTH_API_KEY: oracle path unavailable → admin override unlocks at 2026-10-06T05:33:51.000Z
- admin_settle at $679 — [tx](https://explorer.solana.com/tx/2pB5mTkAqKP2S81pjhKQdSUL5HUu6YE8cLk3d3LEevdrGG5yj43C9UUM3gfp3mC86beBWATgnSzuGQVMRQYupEBu?cluster=custom)
- outcome: **no** at $679 (override: true)
## 7. Makers withdraw, everyone redeems
- MM claim_fills — [tx](https://explorer.solana.com/tx/2zwiNrnXHeCDH2UnqhzFc693d2njwRmmRhLLZ5z9E5py1F6ZFAqL9NCvrkWdDtBADM2RYPsZ6kh82ktbFXnPGnwd?cluster=custom)
- MM cancel order #0 — [tx](https://explorer.solana.com/tx/3UvWusooAeeMpwn1UDz942M6j97tWPYRGN7Z3tvFVz3ZajyZMQLLxpzNPRxexCJgEErRMQU493x5DCV6tf5pLTNy?cluster=custom)
- MM cancel order #1 — [tx](https://explorer.solana.com/tx/5DKHQMaxCgVhcZgAA8tHutix7zVMSSNYS7yL7LEFC455iRpmJcBf7KUQbuPz6p4DQ2At26E58aXxjMp2cbsBfaRV?cluster=custom)
- MM redeem — [tx](https://explorer.solana.com/tx/vi148c5riKpUdRemPEAqNjdApCqmYtmSPJAU3if9mzhKLNjWqRKnWDFGW8xstNyyLoxwF843hzTdFijbsUtMUGb?cluster=custom)
- trader redeem — [tx](https://explorer.solana.com/tx/CoF2WZZUjCpNoEXbJdaAuXeLJLo1xsvEXxXdCsXtbP9wHqUJA9G1dkno6vj8hVEWTdPufayToD5jdERG5HTiWLU?cluster=custom)
## 8. Invariants
- vault balance: 0 (collateral 0) — must be 0
- USDC conserved between the two users: yes (MM -1.35, trader +1.35)
