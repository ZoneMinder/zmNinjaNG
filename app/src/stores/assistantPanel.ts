/**
 * Floating assistant window open/minimized/closed state (refs #246).
 *
 * `state` is session-only (always starts 'closed', so a reload never reopens
 * a stale panel); `size` (the desktop resizable panel's width/height) is the
 * only persisted field, via `partialize`, so a resize survives a reload but
 * the open/minimized/closed state does not. `components/assistant/
 * AssistantWidget.tsx` reads `state` to switch between rendering nothing, a
 * floating FAB, or the full panel; `components/assistant/useAssistantHost.ts`'s
 * `navigate` calls `minimize()` so the agent's `navigate` tool call (or an
 * "Open" card click) collapses the panel to the FAB instead of destroying the
 * conversation underneath it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ASSISTANT_PANEL, STORAGE_KEYS } from '../lib/zmninja-ng-constants';

export type AssistantPanelViewState = 'closed' | 'open' | 'minimized';

export interface AssistantPanelSize {
  width: number;
  height: number;
}

interface AssistantPanelStoreState {
  state: AssistantPanelViewState;
  size: AssistantPanelSize;
  open: () => void;
  minimize: () => void;
  close: () => void;
  setSize: (width: number, height: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const useAssistantPanelStore = create<AssistantPanelStoreState>()(
  persist(
    (set) => ({
      state: 'closed',
      size: { width: ASSISTANT_PANEL.defaultWidth, height: ASSISTANT_PANEL.defaultHeight },
      open: () => set({ state: 'open' }),
      minimize: () => set({ state: 'minimized' }),
      close: () => set({ state: 'closed' }),
      setSize: (width, height) =>
        set({
          size: {
            width: clamp(width, ASSISTANT_PANEL.minWidth, ASSISTANT_PANEL.maxWidth),
            height: clamp(height, ASSISTANT_PANEL.minHeight, ASSISTANT_PANEL.maxHeight),
          },
        }),
    }),
    {
      name: STORAGE_KEYS.assistantPanelStore,
      partialize: (state) => ({ size: state.size }),
    }
  )
);
