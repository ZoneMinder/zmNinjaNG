/**
 * Permission refusals this session has already been told about.
 *
 * The account's columns (`api/users.ts`) do not decide everything. ZoneMinder
 * also keeps per-monitor and per-group permission rows that override them
 * (`web/includes/auth.php`, `editableMonitor`), and nothing in the API exposes
 * those - so a save can still be refused by a server that told us the account
 * has Edit. When that happens the surface latches here and stops offering the
 * action for the rest of the session, which is how the optimistic path stays
 * honest without asking the user to discover the same refusal twice.
 *
 * Deliberately not persisted: granting a permission on the server should take
 * effect on the next launch with no cache to bust.
 */

import { create } from 'zustand';
import type { ProfileId } from '../api/types';

/** The actions a refusal can latch. One per surface that writes. */
export type PermissionSurface = 'monitor-settings' | 'events-edit' | 'run-state' | 'ptz';

interface PermissionDenialState {
  /** `${profileId}:${surface}` or `${profileId}:${surface}:${targetId}`. */
  denied: Record<string, true>;
  /**
   * Records that ZoneMinder refused this action. `targetId` narrows the latch
   * to one monitor or event, for the per-monitor rows the account columns
   * cannot see; leaving it off latches the surface for the whole profile.
   */
  markDenied: (profileId: ProfileId, surface: PermissionSurface, targetId?: string) => void;
}

export function denialKey(
  profileId: ProfileId,
  surface: PermissionSurface,
  targetId?: string,
): string {
  return targetId ? `${profileId}:${surface}:${targetId}` : `${profileId}:${surface}`;
}

export const usePermissionDenialStore = create<PermissionDenialState>((set) => ({
  denied: {},
  markDenied: (profileId, surface, targetId) =>
    set((state) => {
      const key = denialKey(profileId, surface, targetId);
      if (state.denied[key]) return state;
      return { denied: { ...state.denied, [key]: true } };
    }),
}));

/**
 * Whether this surface has already been refused.
 *
 * Reads a single boolean out of the store so a subscribing component
 * re-renders only when its own latch flips, never on another surface's.
 */
export function useIsPermissionDenied(
  profileId: ProfileId | null | undefined,
  surface: PermissionSurface,
  targetId?: string,
): boolean {
  return usePermissionDenialStore((state) =>
    profileId ? state.denied[denialKey(profileId, surface, targetId)] === true : false,
  );
}

/** Records a refusal from outside React (mutation handlers, services). */
export function markPermissionDenied(
  profileId: ProfileId,
  surface: PermissionSurface,
  targetId?: string,
): void {
  usePermissionDenialStore.getState().markDenied(profileId, surface, targetId);
}
