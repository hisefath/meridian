# IDL generator for programs/meridian following the Anchor 0.30+ IDL spec (discriminators = sha256("global:|account:|event:" + name)[..8]).
# Used instead of `anchor idl build` so the build needs only cargo-build-sbf; the LiteSVM suite exercises every
# instruction, account and event through this IDL against the compiled .so, so any drift fails the tests.
import hashlib, json, re, pathlib
disc = lambda s: list(hashlib.sha256(s.encode()).digest()[:8])
camel = lambda s: re.sub(r'_([a-z0-9])', lambda m: m.group(1).upper(), s)
lcfirst = lambda s: s[0].lower() + s[1:]
U8x8x7 = {"array": [{"array": ["u8", 8]}, 7]}
U8x32x7 = {"array": [{"array": ["u8", 32]}, 7]}
D = lambda n: {"defined": {"name": n}}
TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
SYS = "11111111111111111111111111111111"
def acc(name, w=False, s=False, addr=None):
    a = {"name": name}
    if w: a["writable"] = True
    if s: a["signer"] = True
    if addr: a["address"] = addr
    return a
create = [acc("admin", True, True), acc("config"), acc("market", True), acc("yes_mint", True), acc("no_mint", True), acc("vault", True), acc("book", True), acc("book_usdc", True), acc("book_yes", True), acc("usdc_mint"), acc("token_program", addr=TOKEN), acc("system_program", addr=SYS)]
redeem = [acc("user", s=True), acc("market", True), acc("yes_mint", True), acc("no_mint", True), acc("vault", True), acc("user_usdc", True), acc("user_yes", True), acc("user_no", True), acc("token_program", addr=TOKEN)]
mint = [acc("user", s=True), acc("config"), acc("market", True), acc("yes_mint", True), acc("no_mint", True), acc("vault", True), acc("user_usdc", True), acc("user_yes", True), acc("user_no", True), acc("token_program", addr=TOKEN)]
trade = [acc("user", s=True), acc("config"), acc("market"), acc("book", True), acc("book_usdc", True), acc("book_yes", True), acc("user_usdc", True), acc("user_yes", True), acc("token_program", addr=TOKEN)]
admin_only = [acc("admin", s=True), acc("config", True)]
ix = [
 ("initialize_config", [acc("admin", True, True), acc("config", True), acc("usdc_mint"), acc("system_program", addr=SYS)], [("params", D("ConfigParams"))]),
 ("set_admin", admin_only, [("new_admin", "pubkey")]),
 ("set_paused", admin_only, [("paused", "bool")]),
 ("create_strike_market", create, [("ticker", "u8"), ("strike", "u64"), ("close_ts", "i64")]),
 ("add_strike", create, [("ticker", "u8"), ("strike", "u64"), ("close_ts", "i64")]),
 ("mint_pair", mint, [("qty", "u64")]),
 ("redeem_pair", redeem, [("qty", "u64")]),
 ("redeem", redeem, []),
 ("place_order", trade, [("side", D("Side")), ("price", "u8"), ("qty", "u64"), ("order_type", D("OrderType"))]),
 ("cancel_order", trade, [("seq", "u64")]),
 ("claim_fills", trade, []),
 ("settle_market", [acc("config"), acc("market", True), acc("price_update")], []),
 ("admin_settle", [acc("admin", s=True), acc("config"), acc("market", True)], [("price", "u64")]),
]
S = lambda *f: {"kind": "struct", "fields": [{"name": n, "type": t} for n, t in f]}
E = lambda *v: {"kind": "enum", "variants": [{"name": x} for x in v]}
types = {
 "Config": S(("admin","pubkey"),("usdc_mint","pubkey"),("paused","bool"),("max_staleness_secs","u32"),("max_conf_bps","u16"),("override_delay_secs","u32"),("tickers",U8x8x7),("feed_ids",U8x32x7),("bump","u8")),
 "ConfigParams": S(("max_staleness_secs","u32"),("max_conf_bps","u16"),("override_delay_secs","u32"),("tickers",U8x8x7),("feed_ids",U8x32x7)),
 "Market": S(("ticker","u8"),("strike","u64"),("close_ts","i64"),("created_at","i64"),("collateral","u64"),("outcome",D("Outcome")),("settle_price","u64"),("settled_at","i64"),("settled_by_override","bool"),("bump","u8"),("yes_mint","pubkey"),("no_mint","pubkey"),("vault","pubkey"),("book","pubkey"),("book_usdc","pubkey"),("book_yes","pubkey")),
 "Outcome": E("Open","YesWon","NoWon"),
 "Side": E("Bid","Ask"),
 "OrderType": E("Limit","ImmediateOrCancel","FillOrKill"),
 "Order": S(("owner","pubkey"),("qty","u64"),("claimable","u64"),("seq","u64"),("price","u8"),("side","u8"),("_pad",{"array":["u8",6]})),
 "OrderBook": S(("market","pubkey"),("next_seq","u64"),("orders",{"array":[D("Order"),64]})),
 "MarketCreated": S(("market","pubkey"),("ticker","u8"),("strike","u64"),("close_ts","i64"),("intraday","bool")),
 "PairsMinted": S(("market","pubkey"),("user","pubkey"),("qty","u64")),
 "PairsRedeemed": S(("market","pubkey"),("user","pubkey"),("qty","u64")),
 "OrderPlaced": S(("market","pubkey"),("owner","pubkey"),("seq","u64"),("side","u8"),("price","u8"),("qty","u64"),("filled","u64"),("rested","u64")),
 "Fill": S(("market","pubkey"),("maker","pubkey"),("taker","pubkey"),("maker_seq","u64"),("taker_side","u8"),("price","u8"),("qty","u64")),
 "OrderCancelled": S(("market","pubkey"),("owner","pubkey"),("seq","u64"),("qty","u64")),
 "FillsClaimed": S(("market","pubkey"),("owner","pubkey"),("usdc","u64"),("yes","u64")),
 "MarketSettled": S(("market","pubkey"),("price","u64"),("outcome",D("Outcome")),("by_override","bool")),
 "Redeemed": S(("market","pubkey"),("user","pubkey"),("yes_burned","u64"),("no_burned","u64"),("payout","u64")),
}
accounts = ["Config", "Market", "OrderBook"]
events = ["MarketCreated","PairsMinted","PairsRedeemed","OrderPlaced","Fill","OrderCancelled","FillsClaimed","MarketSettled","Redeemed"]
errs = re.findall(r'#\[msg\("([^"]+)"\)\]\s+(\w+),', pathlib.Path('programs/meridian/src/state.rs').read_text())
idl = {
 "address": re.search(r'declare_id!\("(\w+)"\)', pathlib.Path('programs/meridian/src/lib.rs').read_text()).group(1),
 "metadata": {"name": "meridian", "version": "0.1.0", "spec": "0.1.0", "description": "Binary stock-outcome markets with an on-chain order book"},
 "instructions": [{"name": n, "discriminator": disc("global:" + n), "accounts": a, "args": [{"name": an, "type": at} for an, at in args]} for n, a, args in ix],
 "accounts": [{"name": n, "discriminator": disc("account:" + n)} for n in accounts],
 "events": [{"name": n, "discriminator": disc("event:" + n)} for n in events],
 "errors": [{"code": 6000 + i, "name": n, "msg": m} for i, (m, n) in enumerate(errs)],
 "types": [dict({"name": n}, **({"serialization": "bytemuck", "repr": {"kind": "c"}} if n in ("Order", "OrderBook") else {}), type=t) for n, t in types.items()],
}
def to_camel(o, key=None):
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            if k == "name" and isinstance(v, str):
                v = v.lstrip("_"); out[k] = lcfirst(camel(v)) if v[0].isupper() else camel(v)
            else:
                out[k] = to_camel(v, k)
        return out
    if isinstance(o, list): return [to_camel(x, key) for x in o]
    return o
pathlib.Path('sdk/src/idl/meridian.json').write_text(json.dumps(idl, indent=2) + "\n")
ts = to_camel(idl)
pathlib.Path('sdk/src/idl/meridian.ts').write_text("/**\n * Program IDL in camelCase format in order to be used in JS/TS.\n *\n * Note that this is only a type helper and is not the actual IDL. The original\n * IDL can be found at `target/idl/meridian.json`.\n */\nexport type Meridian = " + json.dumps(ts, indent=2) + ";\n")
print(len(idl["instructions"]), "ixs,", len(idl["errors"]), "errors")
