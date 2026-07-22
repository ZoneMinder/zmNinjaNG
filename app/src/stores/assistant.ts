/**
 * In-app assistant conversation store (refs #246).
 *
 * Session-only: no persist middleware. Conversation history and tool
 * activity are throwaway once the app reloads; only the enabled/model
 * settings (settings.ts) survive a restart.
 */

import { create } from 'zustand';
import type { AssistantMessage, AssistantStatus, ToolActivity, TraceEntry } from '../lib/assistant/types';

interface AssistantState {
  // Per-profile conversation threads, keyed by profileId.
  threads: Record<string, AssistantMessage[]>;
  running: boolean;
  activities: ToolActivity[];
  /** The in-flight turn's transcript, so the panel can show it while the turn
   *  is still running. Cleared alongside `activities`; the finished turn keeps
   *  its own copy on the assistant message. */
  liveTrace: TraceEntry[];
  /** The current slow-phase status (model load / prefill / retry / server), or null.
   *  Transient: set by providers via the host, cleared when the turn ends. */
  phase: AssistantStatus | null;
  getThread: (profileId: string) => AssistantMessage[];
  append: (profileId: string, msg: AssistantMessage) => void;
  reset: (profileId: string) => void;
  setRunning: (running: boolean) => void;
  pushActivity: (a: ToolActivity) => void;
  pushTrace: (e: TraceEntry) => void;
  setPhase: (phase: AssistantStatus | null) => void;
  clearActivities: () => void;
}

export const useAssistantStore = create<AssistantState>()((set, get) => ({
  threads: {},
  running: false,
  activities: [],
  liveTrace: [],
  phase: null,
  getThread: (profileId) => get().threads[profileId] ?? [],
  append: (profileId, msg) =>
    set((s) => ({
      threads: { ...s.threads, [profileId]: [...(s.threads[profileId] ?? []), msg] },
    })),
  reset: (profileId) => set((s) => ({ threads: { ...s.threads, [profileId]: [] } })),
  setRunning: (running) => set({ running }),
  pushActivity: (a) => set((s) => ({ activities: [...s.activities, a] })),
  pushTrace: (e) => set((s) => ({ liveTrace: [...s.liveTrace, e] })),
  setPhase: (phase) => set({ phase }),
  clearActivities: () => set({ activities: [], liveTrace: [], phase: null }),
}));
