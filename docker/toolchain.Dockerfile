# Lean native toolchain for building the Solana program (arm64 or x86_64, no emulation).
# ~1 GB, vs ~8.8 GB for solanafoundation/anchor. Platform-tools are fetched by
# cargo-build-sbf on first build into the /root/.cache/solana volume.
FROM rust:1.90-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev libudev-dev curl bzip2 ca-certificates perl make \
 && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-build-sbf --version 4.4.0 --locked && rm -rf /usr/local/cargo/registry /tmp/*
WORKDIR /workspace
