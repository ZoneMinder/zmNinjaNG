/**
 * Command palette open-state (refs #207).
 *
 * Ephemeral UI state in its own store so any entry point (the global key
 * handler, the sidebar button, the mobile header) can open the palette without
 * threading callbacks through the layout.
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
