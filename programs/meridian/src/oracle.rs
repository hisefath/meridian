//! Pyth `PriceUpdateV2` reading and settlement-price validation.
//! Hand-parsed (layout below) instead of depending on pyth-solana-receiver-sdk,
//! whose pinned Anchor/Solana versions are a common source of build breaks.
//!
//! Layout (Borsh): disc[8] | write_authority[32] | verification_level (0 = Partial{u8}, 1 = Full)
//!                 | feed_id[32] | price i64 | conf u64 | exponent i32 | publish_time i64 | ...
use crate::state::MeridianError;
use anchor_lang::prelude::*;

pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/// sha256("account:PriceUpdateV2")[..8]
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PythPrice {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

pub fn parse_price_update(data: &[u8]) -> Result<PythPrice> {
    require!(data.len() >= 41, MeridianError::OracleBadAccount);
    require!(data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR, MeridianError::OracleBadAccount);
    // Partial verification = only some guardian signatures checked; settlement needs Full.
    require!(data[40] == 1, MeridianError::OracleNotFullyVerified);
    let m = &data[41..];
    require!(m.len() >= 60, MeridianError::OracleBadAccount);
    let i64_at = |o: usize| i64::from_le_bytes(m[o..o + 8].try_into().unwrap());
    Ok(PythPrice {
        feed_id: m[0..32].try_into().unwrap(),
        price: i64_at(32),
        conf: u64::from_le_bytes(m[40..48].try_into().unwrap()),
        expo: i32::from_le_bytes(m[48..52].try_into().unwrap()),
        publish_time: i64_at(52),
    })
}

/// price * 10^expo in micro-USD, floored. Floor is exact for `>= strike` checks
/// against integer strikes: floor(x) >= s  <=>  x >= s.
pub fn to_micro_usd(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, MeridianError::OracleBadPrice);
    let shift = expo + 6;
    require!((-18..=18).contains(&shift), MeridianError::OracleBadPrice);
    let p = price as u128;
    let scaled = if shift >= 0 {
        p.checked_mul(10u128.pow(shift as u32)).ok_or(MeridianError::Overflow)?
    } else {
        p / 10u128.pow((-shift) as u32)
    };
    u64::try_from(scaled).map_err(|_| error!(MeridianError::Overflow))
}

/// All settlement checks except account owner (done by the caller). Returns micro-USD price.
pub fn validate(
    p: &PythPrice,
    expected_feed: &[u8; 32],
    close_ts: i64,
    max_staleness_secs: u32,
    max_conf_bps: u16,
) -> Result<u64> {
    require!(&p.feed_id == expected_feed, MeridianError::OracleWrongFeed);
    // Freshness is measured against the close, not "now": we want the closing
    // price even if settlement runs minutes later.
    require!(
        (p.publish_time - close_ts).unsigned_abs() <= max_staleness_secs as u64,
        MeridianError::OracleStale
    );
    require!(p.price > 0, MeridianError::OracleBadPrice);
    require!(
        (p.conf as u128) * 10_000 <= (max_conf_bps as u128) * (p.price as u128),
        MeridianError::OracleConfidenceTooWide
    );
    to_micro_usd(p.price, p.expo)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Real devnet AAPL PriceUpdateV2 account (DJ2FyTgU…), fetched 2026-10-06.
    const DEVNET_AAPL_B64: &str = "IvEjY51+9M22qIobWbfIasZFzYU4kLAmRMXwVLcgFl9Eo5UYbkGDfgFJ9rZcsd5rEOr3XnwDygKcMG0DV+kbUxGxdQhKWtVWiIqGzAEAAAAAgDcAAAAAAAD7////R2xGagAAAABGbEZqAAAAANagyQEAAAAA3FAAAAAAAAATqjgcAAAAAAA=";

    fn b64(s: &str) -> Vec<u8> {
        // tiny decoder to avoid a dev-dependency for one fixture
        let tbl = |c: u8| match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            _ => 63,
        };
        let bytes: Vec<u8> = s.bytes().filter(|&c| c != b'=').collect();
        let mut out = Vec::new();
        for chunk in bytes.chunks(4) {
            let v = chunk.iter().enumerate().fold(0u32, |acc, (i, &c)| acc | (tbl(c) as u32) << (18 - 6 * i));
            for i in 0..chunk.len() - 1 {
                out.push((v >> (16 - 8 * i)) as u8);
            }
        }
        out
    }

    #[test]
    fn parses_real_devnet_account() {
        let p = parse_price_update(&b64(DEVNET_AAPL_B64)).unwrap();
        assert_eq!(
            p.feed_id,
            hex32("49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688")
        );
        assert_eq!((p.price, p.expo, p.conf), (30_181_002, -5, 14_208));
        assert_eq!(to_micro_usd(p.price, p.expo).unwrap(), 301_810_020);
    }

    fn hex32(h: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
        }
        out
    }

    fn sample() -> PythPrice {
        PythPrice { feed_id: [7; 32], price: 68_000_000, conf: 10_000, expo: -5, publish_time: 1_000 }
    }

    #[test]
    fn rejects_partial_verification_and_wrong_discriminator() {
        let mut d = b64(DEVNET_AAPL_B64);
        d[40] = 0;
        assert!(parse_price_update(&d).is_err());
        let mut d = b64(DEVNET_AAPL_B64);
        d[0] ^= 1;
        assert!(parse_price_update(&d).is_err());
    }

    #[test]
    fn staleness_window_is_relative_to_close() {
        let p = sample();
        assert!(validate(&p, &[7; 32], 1_000 + 300, 300, 200).is_ok());
        assert!(validate(&p, &[7; 32], 1_000 - 300, 300, 200).is_ok());
        assert!(validate(&p, &[7; 32], 1_000 + 301, 300, 200).is_err());
    }

    #[test]
    fn wrong_feed_and_wide_confidence_rejected() {
        let p = sample();
        assert!(validate(&p, &[8; 32], 1_000, 300, 200).is_err());
        // 2% of 680.00 = 13.60 -> conf 1_360_000 at expo -5 is exactly the limit
        let ok = PythPrice { conf: 1_360_000, ..p };
        assert!(validate(&ok, &[7; 32], 1_000, 300, 200).is_ok());
        let wide = PythPrice { conf: 1_360_001, ..p };
        assert!(validate(&wide, &[7; 32], 1_000, 300, 200).is_err());
    }

    #[test]
    fn micro_usd_conversion() {
        assert_eq!(to_micro_usd(68_000_000, -5).unwrap(), 680_000_000);
        assert_eq!(to_micro_usd(68_000_000_123, -8).unwrap(), 680_000_001); // floored
        assert_eq!(to_micro_usd(680, 0).unwrap(), 680_000_000);
        assert!(to_micro_usd(0, -5).is_err());
        assert!(to_micro_usd(-1, -5).is_err());
    }

    proptest! {
        // floor(x) >= s  <=>  x >= s for every integer strike: conversion never flips an outcome
        #[test]
        fn flooring_never_flips_outcome(price in 1i64..10_000_000_000, expo in -10i32..=-6, strike_usd in 1u64..2_000) {
            let micro = to_micro_usd(price, expo).unwrap() as u128;
            let strike = strike_usd as u128 * 1_000_000;
            let exact_above = (price as u128) * 1_000_000 >= strike * 10u128.pow((-expo) as u32);
            prop_assert_eq!(micro >= strike, exact_above);
        }
    }
}
