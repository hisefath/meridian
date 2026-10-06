//! Price-time priority matching over a fixed array of order slots.
//! Pure logic (no accounts, no CPI) so it can be unit- and property-tested natively.
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Bid,
    Ask,
}

impl Side {
    pub fn as_u8(self) -> u8 {
        match self {
            Side::Bid => SIDE_BID,
            Side::Ask => SIDE_ASK,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderType {
    /// Unfilled remainder rests on the book.
    Limit,
    /// Unfilled remainder is dropped.
    ImmediateOrCancel,
    /// Must fill completely or the whole transaction fails.
    FillOrKill,
}

#[derive(Debug, PartialEq)]
pub struct MatchFill {
    pub maker: Pubkey,
    pub maker_seq: u64,
    pub price: u8,
    pub qty: u64,
}

#[derive(Debug, PartialEq)]
pub struct Execution {
    pub seq: u64,
    pub filled: u64,
    /// Sum of price_cents * qty over all fills.
    pub notional_cents: u64,
    pub rested: u64,
    pub fills: Vec<MatchFill>,
}

/// Best resting order the taker can hit: lowest ask <= limit for a bid,
/// highest bid >= limit for an ask; ties broken by lowest seq (time priority).
// ponytail: O(N) scan per fill with N = MAX_ORDERS; sorted levels if N grows.
fn best_match(orders: &[Order], taker: Side, limit: u8) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, o) in orders.iter().enumerate() {
        if o.qty == 0 {
            continue;
        }
        let crosses = match taker {
            Side::Bid => o.side == SIDE_ASK && o.price <= limit,
            Side::Ask => o.side == SIDE_BID && o.price >= limit,
        };
        if !crosses {
            continue;
        }
        best = match best {
            None => Some(i),
            Some(b) => {
                let cur = &orders[b];
                let better_price = match taker {
                    Side::Bid => o.price < cur.price,
                    Side::Ask => o.price > cur.price,
                };
                if better_price || (o.price == cur.price && o.seq < cur.seq) {
                    Some(i)
                } else {
                    Some(b)
                }
            }
        };
    }
    best
}

/// Match a new order against the book, crediting makers' `claimable`, then rest
/// any remainder (Limit), drop it (IOC) or fail (FOK). Token movement is the
/// caller's job: this only does the bookkeeping.
pub fn execute(
    book: &mut OrderBook,
    owner: Pubkey,
    side: Side,
    price: u8,
    qty: u64,
    order_type: OrderType,
) -> Result<Execution> {
    require!(qty > 0, MeridianError::ZeroQuantity);
    require!(price >= 1 && price <= MAX_PRICE_CENTS, MeridianError::InvalidPrice);

    let seq = book.next_seq;
    book.next_seq = seq.checked_add(1).ok_or(MeridianError::Overflow)?;

    let mut remaining = qty;
    let mut notional_cents: u64 = 0;
    let mut fills = Vec::new();

    while remaining > 0 {
        let Some(i) = best_match(&book.orders, side, price) else {
            break;
        };
        let maker = &mut book.orders[i];
        let q = remaining.min(maker.qty);
        let leg_cents = (maker.price as u64)
            .checked_mul(q)
            .ok_or(MeridianError::Overflow)?;
        maker.qty -= q;
        // Maker on the ask side sold YES and is owed USDC; a bid maker is owed YES.
        let credit = match side {
            Side::Bid => leg_cents.checked_mul(USDC_PER_CENT).ok_or(MeridianError::Overflow)?,
            Side::Ask => q,
        };
        maker.claimable = maker.claimable.checked_add(credit).ok_or(MeridianError::Overflow)?;
        notional_cents = notional_cents.checked_add(leg_cents).ok_or(MeridianError::Overflow)?;
        remaining -= q;
        fills.push(MatchFill { maker: maker.owner, maker_seq: maker.seq, price: maker.price, qty: q });
    }

    let mut rested = 0;
    if remaining > 0 {
        match order_type {
            OrderType::FillOrKill => return err!(MeridianError::FillOrKillNotFilled),
            OrderType::ImmediateOrCancel => {}
            OrderType::Limit => {
                let slot = book
                    .orders
                    .iter_mut()
                    .find(|o| o.is_free())
                    .ok_or(MeridianError::BookFull)?;
                *slot = Order {
                    owner,
                    qty: remaining,
                    claimable: 0,
                    seq,
                    price,
                    side: side.as_u8(),
                    _pad: [0; 6],
                };
                rested = remaining;
            }
        }
    }

    Ok(Execution { seq, filled: qty - remaining, notional_cents, rested, fills })
}

/// USDC and YES owed back to the owner if order `i` is removed now.
pub fn release(order: &Order) -> Result<(u64, u64)> {
    let escrow_usdc = if order.side == SIDE_BID {
        (order.price as u64)
            .checked_mul(order.qty)
            .and_then(|c| c.checked_mul(USDC_PER_CENT))
            .ok_or(MeridianError::Overflow)?
    } else {
        0
    };
    let escrow_yes = if order.side == SIDE_ASK { order.qty } else { 0 };
    let (claim_usdc, claim_yes) = if order.side == SIDE_BID {
        (0, order.claimable)
    } else {
        (order.claimable, 0)
    };
    Ok((escrow_usdc + claim_usdc, escrow_yes + claim_yes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn empty_book() -> OrderBook {
        OrderBook { market: Pubkey::default(), next_seq: 0, orders: [Order::default(); MAX_ORDERS] }
    }

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    #[test]
    fn rests_when_nothing_crosses() {
        let mut b = empty_book();
        let e = execute(&mut b, pk(1), Side::Bid, 40, 10, OrderType::Limit).unwrap();
        assert_eq!((e.filled, e.rested), (0, 10));
        assert_eq!(b.orders.iter().filter(|o| o.qty > 0).count(), 1);
    }

    #[test]
    fn price_then_time_priority_and_maker_price() {
        let mut b = empty_book();
        execute(&mut b, pk(1), Side::Ask, 60, 5, OrderType::Limit).unwrap(); // seq 0
        execute(&mut b, pk(2), Side::Ask, 55, 5, OrderType::Limit).unwrap(); // seq 1, better price
        execute(&mut b, pk(3), Side::Ask, 55, 5, OrderType::Limit).unwrap(); // seq 2, same price later
        let e = execute(&mut b, pk(9), Side::Bid, 60, 12, OrderType::ImmediateOrCancel).unwrap();
        let order: Vec<_> = e.fills.iter().map(|f| (f.maker, f.price, f.qty)).collect();
        assert_eq!(order, vec![(pk(2), 55, 5), (pk(3), 55, 5), (pk(1), 60, 2)]);
        assert_eq!(e.notional_cents, 55 * 10 + 60 * 2); // taker gets price improvement
        assert_eq!(e.rested, 0);
    }

    #[test]
    fn makers_credited_in_the_right_asset() {
        let mut b = empty_book();
        execute(&mut b, pk(1), Side::Ask, 62, 10, OrderType::Limit).unwrap();
        execute(&mut b, pk(2), Side::Bid, 40, 10, OrderType::Limit).unwrap();
        execute(&mut b, pk(9), Side::Bid, 62, 4, OrderType::FillOrKill).unwrap();
        execute(&mut b, pk(9), Side::Ask, 40, 3, OrderType::FillOrKill).unwrap();
        let ask = b.orders.iter().find(|o| o.owner == pk(1)).unwrap();
        let bid = b.orders.iter().find(|o| o.owner == pk(2)).unwrap();
        assert_eq!((ask.qty, ask.claimable), (6, 4 * 62 * USDC_PER_CENT));
        assert_eq!((bid.qty, bid.claimable), (7, 3));
    }

    #[test]
    fn fok_fails_and_ioc_drops_remainder() {
        let mut b = empty_book();
        execute(&mut b, pk(1), Side::Ask, 50, 3, OrderType::Limit).unwrap();
        let mut copy = b; // OrderBook is Copy (zero-copy POD)
        assert!(execute(&mut copy, pk(9), Side::Bid, 50, 4, OrderType::FillOrKill).is_err());
        let e = execute(&mut b, pk(9), Side::Bid, 50, 4, OrderType::ImmediateOrCancel).unwrap();
        assert_eq!((e.filled, e.rested), (3, 0));
    }

    #[test]
    fn rejects_bad_price_and_full_book() {
        let mut b = empty_book();
        assert!(execute(&mut b, pk(1), Side::Bid, 0, 1, OrderType::Limit).is_err());
        assert!(execute(&mut b, pk(1), Side::Bid, 100, 1, OrderType::Limit).is_err());
        for _ in 0..MAX_ORDERS {
            execute(&mut b, pk(1), Side::Bid, 10, 1, OrderType::Limit).unwrap();
        }
        assert!(execute(&mut b, pk(1), Side::Bid, 10, 1, OrderType::Limit).is_err());
        // a taker that doesn't need a slot still trades on a full book
        assert!(execute(&mut b, pk(2), Side::Ask, 10, 1, OrderType::ImmediateOrCancel).is_ok());
    }

    #[test]
    fn release_returns_escrow_plus_claimable() {
        let o = Order { owner: pk(1), qty: 3, claimable: 2, seq: 0, price: 40, side: SIDE_BID, _pad: [0; 6] };
        assert_eq!(release(&o).unwrap(), (3 * 40 * USDC_PER_CENT, 2));
        let o = Order { side: SIDE_ASK, claimable: 500, ..o };
        assert_eq!(release(&o).unwrap(), (500, 3));
    }

    // Conservation: every USDC/YES unit that enters escrow is either still escrowed
    // for a resting order, credited to a maker, or paid to a taker. And the book
    // never stays crossed.
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(512))]
        #[test]
        fn conservation_and_no_crossed_book(
            ops in proptest::collection::vec((0u8..4, any::<bool>(), 1u8..100, 1u64..20, 0u8..3), 1..120)
        ) {
            let mut b = empty_book();
            let (mut usdc_in, mut usdc_out, mut yes_in, mut yes_out) = (0u64, 0u64, 0u64, 0u64);
            for (who, is_bid, price, qty, ot) in ops {
                let side = if is_bid { Side::Bid } else { Side::Ask };
                let ot = [OrderType::Limit, OrderType::ImmediateOrCancel, OrderType::FillOrKill][ot as usize];
                // a failed instruction reverts on-chain, so only commit on success
                let mut next = b;
                let Ok(e) = execute(&mut next, pk(who), side, price, qty, ot) else { continue };
                b = next;
                // mirror the token flows done by place_order
                match side {
                    Side::Bid => {
                        usdc_in += e.notional_cents * USDC_PER_CENT + e.rested * price as u64 * USDC_PER_CENT;
                        yes_out += e.filled;
                    }
                    Side::Ask => {
                        yes_in += e.filled + e.rested;
                        usdc_out += e.notional_cents * USDC_PER_CENT;
                    }
                }
                let best_bid = b.orders.iter().filter(|o| o.qty > 0 && o.side == SIDE_BID).map(|o| o.price).max();
                let best_ask = b.orders.iter().filter(|o| o.qty > 0 && o.side == SIDE_ASK).map(|o| o.price).min();
                if let (Some(bb), Some(ba)) = (best_bid, best_ask) {
                    prop_assert!(bb < ba, "crossed book {} >= {}", bb, ba);
                }
            }
            // what's still owed to slot owners must equal what escrow holds
            let (mut owed_usdc, mut owed_yes) = (0u64, 0u64);
            for o in b.orders.iter() {
                let (u, y) = release(o).unwrap();
                owed_usdc += u;
                owed_yes += y;
            }
            prop_assert_eq!(usdc_in - usdc_out, owed_usdc);
            prop_assert_eq!(yes_in - yes_out, owed_yes);
        }
    }
}
