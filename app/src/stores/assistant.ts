/**
 * In-app assistant conversation store (refs #246).
 *
 * Session-only: no persist middleware. Conversation history and tool
 * activity are throwaway once the app reloads; only the enabled/model
 * settings (settings.ts) survive a restart.
 */

import { create } from 'zustand';
import type { AssistantMessage, ToolActivity } from '../lib/assistant/types';

interface AssistantState {
  // Per-profile conversation threads, keyed by profileId.
  threads: Record<string, AssistantMessage[]>;
  running: boolean;
  activities: ToolActivity[];
  getThread: (profileId: string) => AssistantMessage[];
  append: (profileId: string, msg: AssistantMessage) => void;
  reset: (profileId: string) => void;
  setRunning: (running: boolean) => void;
  pushActivity: (a: ToolActivity) => void;
  clearActivities: () => void;
}

export const useAssistantStore = create<AssistantState>()((set, get) => ({
  threads: {},
  running: false,
  activities: [],
  getThread: (profileId) => get().threads[profileId] ?? [],
  append: (profileId, msg) =>
    set((s) => ({
      threads: { ...s.threads, [profileId]: [...(s.threads[profileId] ?? []), msg] },
    })),
  reset: (profileId) => set((s) => ({ threads: { ...s.threads, [profileId]: [] } })),
  setRunning: (running) => set({ running }),
  pushActivity: (a) => set((s) => ({ activities: [...s.activities, a] })),
  clearActivities: () => set({ activities: [] }),
}));
