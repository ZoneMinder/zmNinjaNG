/**
 * Deterministic per-query polling stagger.
 *
 * An aggregate hook fans one query out per profile in scope, all on the
 * same base interval - which fires every profile's refetch as one
 * synchronized burst against N different servers. This spreads those
 * bursts apart.
 *
 * Semantics: query index `i` of `count` gets `basePeriod` plus a
 * deterministic jitter of `i * basePeriod / (2 * count)`, so:
 * - index 0 always gets exactly `basePeriod` (no jitter).
 * - every other index gets a strictly larger, distinct period, bounded
 *   to `basePeriod + basePeriod/2` (1.5x) as `count` grows.
 *
 * This is a real (if small) period difference per query, not just a
 * one-time offset - each query's own refetch schedule reruns from its own
 * last fetch, so the periods stay desynchronized fire-over-fire instead of
 * just on the first tick. The tradeoff is the deliberate ceiling: any one
 * profile's worst-case refetch latency grows by at most 50% of the base
 * interval, which is a fine price for turning an N-way synchronized burst
 * into a spread.
 */
export function staggeredRefetchInterval(index: number, count: number, basePeriod: number): number {
  if (count <= 1) return basePeriod;
  return basePeriod + (index * basePeriod) / (2 * count);
}
