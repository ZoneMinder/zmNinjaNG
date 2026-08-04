/**
 * The kebab's show-monitors list, derived from the scoped monitor list.
 *
 * Lives beside `tileIdFor` because the two have to agree: an entry's toggle
 * key IS the tile id, so a list built with a different key would toggle
 * nothing. Montage.tsx only needs the result.
 */

import { useMemo } from 'react';
import { tileIdFor } from './useMontageGrid';
import type { MontageVisibilityItem } from '../MontageKebabMenu';
import type { Scoped } from '../../../api/scoped-types';
import type { MonitorData, ProfileId } from '../../../api/types';

/**
 * Build the show-monitors list. The input is the FULL scoped monitor list,
 * never a group-filtered one: the list must be able to un-hide any monitor
 * regardless of the active group filter, or a monitor hidden while outside
 * that group becomes permanently un-hideable (refs #337, a single-mode
 * regression).
 *
 * Entries carry their owning server's name in All mode, where two servers can
 * show the same monitor name, and cluster by server in the order
 * `useScopedMonitors` returns them - the same order the grid's per-server
 * sections use.
 */
export function useMontageVisibilityItems(
  scopedMonitors: Scoped<MonitorData>[],
  isAllMode: boolean
): MontageVisibilityItem[] {
  return useMemo(() => {
    const profileRank = new Map<ProfileId, number>();
    for (const s of scopedMonitors) {
      if (!profileRank.has(s.profileId)) profileRank.set(s.profileId, profileRank.size);
    }
    const rank = (s: Scoped<MonitorData>) => profileRank.get(s.profileId) ?? 0;
    const sequence = (s: Scoped<MonitorData>) => Number(s.item.Monitor.Sequence ?? 0);
    return [...scopedMonitors]
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          sequence(a) - sequence(b) ||
          (a.item.Monitor.Name ?? '').localeCompare(b.item.Monitor.Name ?? '')
      )
      .map((s) => ({
        id: isAllMode ? tileIdFor({ ...s.item, profileId: s.profileId }) : s.item.Monitor.Id,
        name: s.item.Monitor.Name ?? '',
        profileChip: isAllMode ? s.profileName : undefined,
      }));
  }, [scopedMonitors, isAllMode]);
}
