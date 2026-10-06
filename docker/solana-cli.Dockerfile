# Solana CLI for deploys/airdrops only (Anza ships Linux binaries for x86_64; nothing is compiled here).
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -sSfL https://github.com/anza-xyz/agave/releases/download/v2.3.13/solana-release-x86_64-unknown-linux-gnu.tar.bz2 \
  | tar -xj -C /opt solana-release/bin/solana solana-release/bin/solana-keygen solana-release/bin/solana-test-validator \
 && ln -s /opt/solana-release/bin/solana /opt/solana-release/bin/solana-keygen /opt/solana-release/bin/solana-test-validator /usr/local/bin/
WORKDIR /workspace
