# Lean native toolchain for building the Solana program (works on arm64 and x86_64 hosts
# without emulation). ~1.5 GB vs ~8.8 GB for solanafoundation/anchor.
FROM rust:1.90-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev libudev-dev curl bzip2 ca-certificates perl make \
 && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-build-sbf --version 4.4.0 --locked \
 && cargo install anchor-cli --version 0.32.1 --locked \
 && rm -rf /usr/local/cargo/registry /tmp/*
WORKDIR /workspace
