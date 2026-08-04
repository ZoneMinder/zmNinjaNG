/**
 * All-mode stream budget
 *
 * Shares a fixed number of live streams across the servers in scope
 * (refs #337). The budget itself is `allModeMaxStreams`; this decides who
 * spends it.
 *
 * A global first-N slice is the obvious implementation and the wrong one: the
 * scoped monitor list arrives clustered by profile, so the first server in
 * profile order eats the whole budget and every later server renders nothing.
 * A user watching four servers sees one.
 *
 * Instead the slots are dealt round-robin in profile order, one per server per
 * pass, until the budget runs out or every server has all of its monitors. Two
 * servers of ten monitors on a budget of four get two each; on five, the first
 * server takes the odd slot. A server with fewer monitors than its even share
 * drops out of later passes, so its unused slots go to servers that can fill
 * them and the budget is always spent in full.
 *
 * Only the aggregate view calls this. Single mode has no cap and never slices.
 */

/**
 * Picks which items fit the budget, preserving the input order (and so each
 * server's own monitor order).
 *
 * @param items - Scoped items in profile order, clustered by profile.
 * @param budget - Total items allowed. Zero or less allows none.
 * @param profileOf - The owning profile of an item.
 * @returns The kept items, or `items` itself when everything fits, so callers
 *   that memoize on identity see no change when the budget is not binding.
 */
export function allocateStreamBudget<T>(
  items: T[],
  budget: number,
  profileOf: (item: T) => string,
): T[] {
  if (budget <= 0) return [];
  if (items.length <= budget) return items;

  // Insertion order is first-appearance order, which is profile order.
  const totals = new Map<string, number>();
  for (const item of items) {
    const key = profileOf(item);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const share = new Map<string, number>();
  let unspent = budget;
  while (unspent > 0) {
    let dealt = false;
    for (const [key, total] of totals) {
      if (unspent === 0) break;
      const taken = share.get(key) ?? 0;
      if (taken >= total) continue;
      share.set(key, taken + 1);
      unspent -= 1;
      dealt = true;
    }
    // Every server is out of monitors while the budget still has slots. Cannot
    // happen for items.length > budget, but a pass that deals nothing would
    // otherwise spin forever.
    if (!dealt) break;
  }

  const spent = new Map<string, number>();
  return items.filter((item) => {
    const key = profileOf(item);
    const taken = spent.get(key) ?? 0;
    if (taken >= (share.get(key) ?? 0)) return false;
    spent.set(key, taken + 1);
    return true;
  });
}
