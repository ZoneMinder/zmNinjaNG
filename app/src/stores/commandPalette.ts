/**
 * Command palette open-state (refs #207).
 *
 * Ephemeral UI state in its own store so any entry point (the global key
 * handler, the sidebar button, the mobile header) can open the palette without
 * threading callbacks through the layout. The on-device assistant used to be
 * hosted inside this palette as an "Ask mode" (refs #246); it is now its own
 * always-mounted floating window (`stores/assistantPanel.ts`,
 * `components/assistant/AssistantWidget.tsx`), so this store only ever tracks
 * the palette's own open/closed state.
 */

import { create } from 'zustand';

interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
