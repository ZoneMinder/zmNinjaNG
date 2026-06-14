import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';

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
