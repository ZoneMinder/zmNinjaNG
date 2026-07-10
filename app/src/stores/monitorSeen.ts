/**
 * Monitor "seen" watermarks.
 *
 * Per profile, per monitor: the StartDateTime of the newest event the user had
 * seen the last time they looked at that monitor's events. The monitor card
 * badge counts events recorded after it.
 *
 * Absent versus null is load-bearing. An absent key means the monitor has never
 * been seeded, so the first response seeds it and shows no badge (a fresh
 * install must not greet the user with a week of backlog). A stored null means
 * the monitor had no events at all when it was seeded, so every event since is
 * new and the count query runs unfiltered (refs #239).
 *
 * The value is always a server StartDateTime, never a local Date.now(): clock
 * skew between the app and the ZoneMinder server would hide or duplicate events.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';

interface MonitorSeenState {
  // profileId -> monitorId -> newest seen StartDateTime (null: seeded empty)
  profileWatermarks: Record<string, Record<string, string | null>>;

  hasWatermark: (profileId: string, monitorId: string) => boolean;
  getWatermark: (profileId: string, monitorId: string) => string | null;
  seed: (profileId: string, monitorId: string, newest: string | null) => void;
  markSeen: (profileId: string, monitorId: string, newest: string | null) => void;
  clearProfile: (profileId: string) => void;
}

function withWatermark(
  state: MonitorSeenState,
  profileId: string,
  monitorId: string,
  newest: string | null
): Pick<MonitorSeenState, 'profileWatermarks'> {
  return {
    profileWatermarks: {
      ...state.profileWatermarks,
      [profileId]: { ...(state.profileWatermarks[profileId] ?? {}), [monitorId]: newest },
    },
  };
}

export const useMonitorSeenStore = create<MonitorSeenState>()(
  persist(
    (set, get) => ({
      profileWatermarks: {},

      hasWatermark: (profileId, monitorId) =>
        Object.prototype.hasOwnProperty.call(
          get().profileWatermarks[profileId] ?? {},
          monitorId
        ),

      getWatermark: (profileId, monitorId) =>
        get().profileWatermarks[profileId]?.[monitorId] ?? null,

      seed: (profileId, monitorId, newest) => {
        if (get().hasWatermark(profileId, monitorId)) return;
        set((state) => withWatermark(state, profileId, monitorId, newest));
      },

      markSeen: (profileId, monitorId, newest) => {
        if (newest === null) return;
        set((state) => withWatermark(state, profileId, monitorId, newest));
      },

      clearProfile: (profileId) => {
        set((state) => {
          if (!state.profileWatermarks[profileId]) return state;
          const next = { ...state.profileWatermarks };
          delete next[profileId];
          return { ...state, profileWatermarks: next };
        });
      },
    }),
    {
      name: STORAGE_KEYS.monitorSeenStore,
    }
  )
);
