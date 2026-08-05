import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';
import type { ProfileId } from '../api/types';

/**
 * Composite key for connKeys (and the go2rtcFailureCache in LiveMonitorPlayer,
 * which reuses this so the two caches agree on one key format). Monitor ids
 * are only unique within one ZM server, so two profiles pointed at
 * independent servers can share a monitor id; keying by monitorId alone
 * collided their connkeys and Go2RTC failure state (refs #337). Falls back to
 * the bare monitorId when no profileId is known, so a caller that has not
 * been threaded a profileId yet degrades to the pre-existing single-mode key.
 */
export function monitorCacheKey(profileId: ProfileId | null | undefined, monitorId: string): string {
  return profileId ? `${profileId}:${monitorId}` : monitorId;
}

interface MonitorStore {
    connKeys: Record<string, number>;
    getConnKey: (monitorId: string) => number;
    regenerateConnKey: (monitorId: string) => number;
    clearConnKey: (monitorId: string) => void;
}

/**
 * Helper to generate and store a new connection key for a monitor
 */
function generateAndSetConnKey(
    monitorId: string,
    set: (fn: (state: MonitorStore) => Partial<MonitorStore>) => void
): number {
    const newKey = Math.floor(Math.random() * 100000);
    set((state) => ({
        connKeys: {
            ...state.connKeys,
            [monitorId]: newKey,
        },
    }));
    return newKey;
}

export const useMonitorStore = create<MonitorStore>()(
    persist(
        (set, get) => ({
            connKeys: {},
            getConnKey: (monitorId: string) => {
                const state = get();
                if (state.connKeys[monitorId]) {
                    return state.connKeys[monitorId];
                }

                return generateAndSetConnKey(monitorId, set);
            },
            regenerateConnKey: (monitorId: string) => {
                return generateAndSetConnKey(monitorId, set);
            },
            // Remove the stored key so the next mount generates a fresh one.
            // Called by useStreamLifecycle after CMD_QUIT on unmount; reusing
            // a quit key can collide with the server-side stream state.
            clearConnKey: (monitorId: string) => {
                set((state) => {
                    const next = { ...state.connKeys };
                    delete next[monitorId];
                    return { connKeys: next };
                });
            },
        }),
        {
            name: STORAGE_KEYS.monitorStore,
        }
    )
);
