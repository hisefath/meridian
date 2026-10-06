# AI Usage Log

The brief requires documenting AI usage. Meridian was built with **Claude Code** (Anthropic, model Claude Opus 5.5) acting as an autonomous pair-programmer, with the human engineer (Sefath Chowdhury) setting direction, constraints and review.

## How AI was used

| Area | What the AI did | Human role |
|---|---|---|
| Requirements | Extracted the PDF brief into `docs/PRD.md`, with acceptance criteria and explicit assumptions | Set the deliverable list, repo setup and documentation format |
| Architecture | Proposed and justified chain, CLOB, oracle, settlement and testing choices (`docs/ARCHITECTURE.md`, `docs/SYSTEM_DESIGN.md`) and kept a private decision journal | Owns the final decisions and must defend them in review |
| Research | Live checks instead of assumptions: decoded Pyth's devnet/mainnet push-feed accounts (equity feeds stale since mid-2026), discovered Hermes now needs an API key (401s), looked up the MAG7 Pyth feed ids and market-hours calendar | — |
| Smart contract | Wrote the Anchor program: config, markets, mint/redeem, matching engine, settlement, override, pause | Review |
| Tests | Rust unit and property tests, LiteSVM integration suites, randomized invariant runs, automation tests, frontend UI-flow tests | Review |
| Automation / frontend / scripts | TypeScript automation service, Next.js app, devnet setup and lifecycle scripts, Makefile, Dockerfiles | Review, demo recording |
| Docs | All documents in `docs/`, `RISKS.md`, README | Review |

## Notable AI-session events (honest log)
1. **Toolchain blocked by the local firewall.** Little Snitch denied network for `rustup`, the Agave installer and Node (except npm). `curl`, `git`, `python` and Docker were allowed. The AI did not change firewall settings. It moved the Solana toolchain into Docker.
2. **Disk exhaustion.** The official `solanafoundation/anchor` image (8.8 GB, amd64-only) filled the disk, and the x86 emulation segfaulted the linker. The AI removed only the image it had pulled and switched to a ~1 GB native toolchain image (`docker/toolchain.Dockerfile`). It surfaced the low-disk state to the user instead of deleting anything that wasn't its own.
3. **Platform-tools Rust 1.84 vs edition-2024 crates.** Fixed with Cargo's MSRV-aware resolver (`.cargo/config.toml`, `rust-version = "1.84"`) rather than hand-pinning crates.
4. **IDL generation.** To avoid compiling `anchor-cli` under the disk constraint, the IDL is produced by `scripts/gen_idl.py`, following the Anchor IDL spec. The LiteSVM suite validates it against the compiled program.
5. **jsdom + web3.js typed-array realm bug** in the frontend tests. Root-caused with a probe test and fixed in `app/src/test/setup.ts`.
6. **Bugs the tests caught during development:** listed in `docs/TEST_RESULTS.md`.

## Guardrails followed
- No secrets committed. Keypairs live in `keys/` (gitignored) and config in `.env` (gitignored). `.env.example` is provided.
- Devnet and test funds only, and no mainnet interaction.
- No account creation on the user's behalf (the Pyth API key requires the human to sign up).
- Every claim in the docs about external systems (Pyth feeds, Hermes auth, crate versions) was checked live during the session.

## Verification of AI output
Correctness was established by tests rather than by trusting generated code. See `docs/TEST_RESULTS.md` for the suites, counts and the scenarios they cover. On-chain behaviour is additionally proven by the devnet lifecycle transcript (`docs/devnet-lifecycle-run.md`).
