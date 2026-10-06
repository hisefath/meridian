// Pyth Hermes client: market calendar (unauthenticated metadata) and signed price
// updates (API key required since 2026-08-26).

export interface PriceUpdate {
  feedId: string;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
  /** base64 accumulator update, posted on-chain via the Pyth receiver */
  binary: string;
}

export interface MarketHours {
  isOpen: boolean;
  nextOpen: number | null;
  nextClose: number | null;
}

export class Hermes {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://pyth.dourolabs.app/hermes',
    private readonly metaUrl = 'https://hermes.pyth.network',
  ) {}

  get hasKey() {
    return !!this.apiKey;
  }

  private async get(url: string, auth: boolean) {
    const res = await fetch(url, { headers: auth && this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {} });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Hermes ${res.status} ${await res.text()} (${url.split('?')[0]})`);
    return res.json();
  }

  async marketHours(feedId: string): Promise<MarketHours> {
    const list = await this.get(`${this.metaUrl}/v2/price_feeds?asset_type=equity&query=`, false);
    const f = (list as any[]).find((x) => x.id === feedId);
    if (!f?.market_hours) throw new Error(`no market hours for feed ${feedId}`);
    return { isOpen: f.market_hours.is_open, nextOpen: f.market_hours.next_open, nextClose: f.market_hours.next_close };
  }

  private parse(body: any): PriceUpdate | null {
    const p = body?.parsed?.[0];
    if (!p) return null;
    return {
      feedId: p.id,
      price: BigInt(p.price.price),
      conf: BigInt(p.price.conf),
      expo: p.price.expo,
      publishTime: p.price.publish_time,
      binary: body.binary.data[0],
    };
  }

  latest(feedId: string) {
    return this.get(`${this.baseUrl}/v2/updates/price/latest?ids[]=${feedId}&parsed=true&encoding=base64`, true).then((b) => this.parse(b));
  }

  /** The update Hermes holds for a given second (used to fetch the price at the close). */
  at(feedId: string, unixSecs: number) {
    return this.get(`${this.baseUrl}/v2/updates/price/${unixSecs}?ids[]=${feedId}&parsed=true&encoding=base64`, true).then((b) => this.parse(b));
  }
}

/** micro-USD, floored, mirroring the program's conversion. */
export function toMicro(price: bigint, expo: number): bigint {
  const shift = expo + 6;
  return shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
}

/**
 * The same acceptance rules settle_market enforces on-chain. Checked off-chain first so
 * we never pay to post an update the program will reject.
 */
export function acceptable(u: PriceUpdate, closeTs: number, maxStalenessSecs: number, maxConfBps: number): string | null {
  if (Math.abs(u.publishTime - closeTs) > maxStalenessSecs) return `stale: publish ${u.publishTime} vs close ${closeTs}`;
  if (u.price <= 0n) return 'non-positive price';
  if (u.conf * 10_000n > BigInt(maxConfBps) * u.price) return `confidence too wide: ${u.conf}/${u.price}`;
  return null;
}
