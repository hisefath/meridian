const STEP = 10_000_000n; // $10 in micro-USD

/**
 * Strikes at ±pcts% of the previous close (plus the close itself), each rounded
 * half-up to the nearest $10, de-duplicated and sorted. Integer math only.
 * META 680 -> 620,640,660,680,700,720,740; AAPL 230 -> 210,220,230,240,250.
 */
export function computeStrikes(prevCloseMicro: bigint, pcts: number[] = [3, 6, 9], includeAtm = true): bigint[] {
  const moves = [...pcts.map((p) => -p), ...(includeAtm ? [0] : []), ...pcts];
  const out = new Set<bigint>();
  for (const pct of moves) {
    const num = prevCloseMicro * BigInt(100 + pct);
    const den = 100n * STEP;
    const strike = ((num + den / 2n) / den) * STEP;
    if (strike > 0n) out.add(strike);
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export const microToUsd = (micro: bigint | number) => Number(micro) / 1_000_000;
export const usdToMicro = (usd: number) => BigInt(Math.round(usd * 1_000_000));
