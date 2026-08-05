/**
 * Transient selection of events queued for bulk deletion (refs #213). Session
 * only, not persisted. Cleared on cancel or after a successful bulk delete;
 * a partial failure keeps the events that survived selected (`remove`).
 */
import { create } from 'zustand';
import { asProfileId, type ProfileId } from '../api/types';

/**
 * Composite selection key. A raw ZoneMinder event id only identifies an event
 * within one server, so in All mode selecting event 1234 on profile A used to
 * select (and would have deleted) event 1234 on profile B as well (refs #337).
 * Mirrors `monitorCacheKey` (stores/monitors.ts): `${profileId}:${eventId}`,
 * falling back to the bare eventId for a caller with no profile in hand, which
 * is exactly the pre-existing single-mode key.
 */
export function eventSelectionKey(profileId: ProfileId | null | undefined, eventId: string): string {
  return profileId ? `${profileId}:${eventId}` : eventId;
}

/**
 * Split a selection key back into its owning profile and event id. Splits on
 * the FIRST ':' like resolveOwnMonitorIds (hooks/useScopedEvents.ts) does for
 * the composite monitor-filter tokens. No ':' means a bare single-mode key, so
 * the profile is left undefined and the caller supplies the current one.
 */
export function parseEventSelectionKey(key: string): { profileId?: ProfileId; eventId: string } {
  const sep = key.indexOf(':');
  if (sep === -1) return { eventId: key };
  return { profileId: asProfileId(key.slice(0, sep)), eventId: key.slice(sep + 1) };
}

interface DeleteSelectionState {
  /** Composite keys from `eventSelectionKey`, never bare ids in All mode. */
  selectedKeys: string[];
  toggle: (key: string) => void;
  /** Drop specific keys, e.g. the events a partly failed bulk delete removed. */
  remove: (keys: string[]) => void;
  clear: () => void;
}

export const useDeleteSelectionStore = create<DeleteSelectionState>((set) => ({
  selectedKeys: [],
  toggle: (key) =>
    set((s) => ({
      selectedKeys: s.selectedKeys.includes(key)
        ? s.selectedKeys.filter((k) => k !== key)
        : [...s.selectedKeys, key],
    })),
  remove: (keys) =>
    set((s) => {
      const dropped = new Set(keys);
      return { selectedKeys: s.selectedKeys.filter((k) => !dropped.has(k)) };
    }),
  clear: () => set({ selectedKeys: [] }),
}));
