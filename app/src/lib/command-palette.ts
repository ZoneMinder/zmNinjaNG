/**
 * Command palette item model and filtering (refs #207).
 *
 * Pure data + a single filter function so the matching/ranking logic is unit
 * tested without React. The component builds CommandItem[] from live data.
 */

export type CommandItem =
  | { kind: 'page'; id: string; label: string; route: string; hintKey?: string }
  /** All mode carries the owning profile: monitor ids collide across servers,
   *  so `profileId` both disambiguates the row and selects the /all/ route
   *  the palette navigates to, and `profileName` labels it (refs #337). */
  | { kind: 'monitor'; id: string; label: string; monitorId: string; profileId?: string; profileName?: string }
  | { kind: 'group'; id: string; label: string; groupId: string };

// Fixed render order between kinds: pages, then groups, then monitors.
const KIND_WEIGHT: Record<CommandItem['kind'], number> = { page: 0, group: 1, monitor: 2 };

/**
 * Filter and rank items for a query.
 *
 * Empty query returns pages and groups only (monitor lists get long). A
 * non-empty query is matched case-insensitively against the label, and a
 * monitor also matches when its ID equals the typed digits. Results are ordered
 * by kind (pages, groups, monitors), then prefix-before-substring, then stable
 * source order.
 */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return items.filter((it) => it.kind !== 'monitor');
  }

  const isPrefix = (it: CommandItem): boolean => {
    if (it.kind === 'monitor' && it.monitorId === q) return true;
    return it.label.toLowerCase().startsWith(q);
  };
  const isMatch = (it: CommandItem): boolean => {
    if (it.label.toLowerCase().includes(q)) return true;
    return it.kind === 'monitor' && it.monitorId === q;
  };

  return items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => isMatch(it))
    .sort((a, b) =>
      KIND_WEIGHT[a.it.kind] - KIND_WEIGHT[b.it.kind] ||
      (isPrefix(a.it) ? 0 : 1) - (isPrefix(b.it) ? 0 : 1) ||
      a.index - b.index
    )
    .map(({ it }) => it);
}
