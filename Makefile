# Meridian — every target needs only Docker + Node (no local Rust/Solana toolchain).
ENV_FILE ?= .env
# Program toolchain: native arch, build output kept in a Docker volume, artifacts copied back to ./target
TOOLCHAIN = docker run --rm -v "$(CURDIR)":/workspace -v meridian-target:/workspace/target -v "$(CURDIR)/target":/host-target \
	-v meridian-cargo-registry:/usr/local/cargo/registry -v meridian-solana-cache:/root/.cache/solana meridian-toolchain
SOLANA = docker run --rm --platform linux/amd64 -v "$(CURDIR)":/workspace meridian-solana
NODE = docker run --rm --env-file $(ENV_FILE) -v "$(CURDIR)/keys":/app/keys:ro -v "$(CURDIR)/docs":/app/docs meridian-automation

.PHONY: localnet localnet-deploy localnet-demo dev install toolchain build test test-rust test-ts deploy-devnet setup-devnet lifecycle-devnet automation-image automation demo-market

dev: install            ## one command: run the trading app against devnet on http://localhost:3000
	npm run dev -w app

install:
	npm install

toolchain:              ## one-time: build the program toolchain + solana CLI images
	docker build -f docker/toolchain.Dockerfile -t meridian-toolchain docker
	docker build -f docker/solana-cli.Dockerfile -t meridian-solana docker

build:                  ## compile the program to target/deploy/meridian.so and regenerate the SDK IDL
	@mkdir -p target/deploy
	$(TOOLCHAIN) sh -c 'cargo build-sbf --arch v0 --manifest-path programs/meridian/Cargo.toml --sbf-out-dir target/deploy \
		&& cp target/deploy/meridian.so /host-target/deploy/'
	python3 scripts/gen_idl.py

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

# ---- local network (no devnet SOL needed). Needs Surfpool: https://github.com/txtx/surfpool/releases
LOCAL = docker run --rm --env-file .env.localnet -v "$(CURDIR)/keys":/app/keys:ro -v "$(CURDIR)/docs":/app/docs meridian-automation

localnet:               ## start Surfpool on :8899 with the admin/MM/trader keys funded (foreground)
	surfpool start --offline --no-deploy --no-tui --no-studio --host 0.0.0.0 -p 8899 -w 8900 -q 100000000000 \
		$(foreach k,admin mm trader,-a $$(docker run --rm -v "$(CURDIR)/keys":/keys meridian-solana solana-keygen pubkey /keys/$(k).json))

localnet-deploy: automation-image   ## deploy the program to Surfpool + create mint/config
	$(SOLANA) solana program deploy target/deploy/meridian.so --program-id keys/meridian-program.json \
		--keypair keys/admin.json --url http://host.docker.internal:8899
	$(LOCAL) npx tsx scripts/setup-devnet.ts

localnet-demo: automation-image     ## morning job + MM quotes + lifecycle run, then: make dev-localnet
	$(LOCAL) npx tsx automation/src/index.ts morning
	$(LOCAL) npx tsx scripts/seed-quotes.ts
	$(LOCAL) npx tsx scripts/lifecycle.ts

dev-localnet:           ## app against Surfpool with the dev-only burner wallet
	NEXT_PUBLIC_RPC_URL=http://localhost:8899 NEXT_PUBLIC_ENABLE_BURNER=true FAUCET_KEYPAIR=keys/admin.json npm run dev -w app
