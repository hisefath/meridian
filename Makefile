# Meridian — every target needs only Docker + Node (no local Rust/Solana toolchain).
ENV_FILE ?= .env
# Program toolchain: native arch, build output kept in a Docker volume, artifacts copied back to ./target
TOOLCHAIN = docker run --rm -v "$(CURDIR)":/workspace -v meridian-target:/workspace/target -v "$(CURDIR)/target":/host-target \
	-v meridian-cargo-registry:/usr/local/cargo/registry -v meridian-solana-cache:/root/.cache/solana meridian-toolchain
SOLANA = docker run --rm --platform linux/amd64 -v "$(CURDIR)":/workspace meridian-solana
NODE = docker run --rm --env-file $(ENV_FILE) -v "$(CURDIR)/keys":/app/keys:ro -v "$(CURDIR)/docs":/app/docs meridian-automation

.PHONY: dev install toolchain build test test-rust test-ts deploy-devnet setup-devnet lifecycle-devnet automation-image automation demo-market

dev: install            ## one command: run the trading app against devnet on http://localhost:3000
	npm run dev -w app

install:
	npm install

toolchain:              ## one-time: build the program toolchain + solana CLI images
	docker build -f docker/toolchain.Dockerfile -t meridian-toolchain docker
	docker build -f docker/solana-cli.Dockerfile -t meridian-solana docker

build:                  ## compile the program + IDL, copy artifacts to ./target and the IDL into the SDK
	@mkdir -p target
	$(TOOLCHAIN) sh -c 'mkdir -p target/deploy && cp keys/meridian-program.json target/deploy/meridian-keypair.json \
		&& anchor build && mkdir -p /host-target/deploy /host-target/idl /host-target/types \
		&& cp target/deploy/meridian.so /host-target/deploy/ && cp target/idl/meridian.json /host-target/idl/ \
		&& cp target/types/meridian.ts /host-target/types/'
	cp target/idl/meridian.json sdk/src/idl/meridian.json
	cp target/types/meridian.ts sdk/src/idl/meridian.ts

test: test-rust test-ts ## all tests

test-rust:              ## pure Rust unit + property tests (matching engine, oracle, payout)
	$(TOOLCHAIN) cargo test -p meridian --lib

test-ts:                ## SDK, automation and LiteSVM integration tests + frontend tests
	npx vitest run
	npm test -w app

deploy-devnet:          ## deploy/upgrade the program on devnet (admin = upgrade authority)
	$(SOLANA) solana program deploy target/deploy/meridian.so \
		--program-id keys/meridian-program.json --keypair keys/admin.json --url devnet

airdrop:                ## devnet SOL for the admin key (rate-limited by the faucet)
	$(SOLANA) solana airdrop 2 --keypair keys/admin.json --url devnet

automation-image:
	docker build -f automation/Dockerfile -t meridian-automation .

setup-devnet: automation-image   ## create test-USDC mint + initialize config (idempotent)
	$(NODE) npx tsx scripts/setup-devnet.ts

lifecycle-devnet: automation-image   ## create → mint → trade → settle → redeem on devnet
	$(NODE) npx tsx scripts/lifecycle.ts

automation: automation-image     ## run the scheduler (morning job + settler)
	docker run --rm --env-file $(ENV_FILE) -v "$(CURDIR)/keys":/app/keys:ro meridian-automation

demo-market: automation-image    ## e.g. make demo-market ARGS="--ticker META --strike 680 --minutes 10"
	$(NODE) npx tsx automation/src/index.ts demo $(ARGS)
