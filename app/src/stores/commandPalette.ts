/**
 * Command palette open-state (refs #207, #246).
 *
 * Ephemeral UI state in its own store so any entry point (the global key
 * handler, the sidebar button, the mobile header) can open the palette without
 * threading callbacks through the layout. `mode` distinguishes the normal
 * command list from the on-device assistant's Ask panel (refs #246):
 * `openAsk()` is the entry point for the `?` key and the palette's "Ask" item,
 * and `setOpen(false)` always resets `mode` back to 'command' so reopening the
 * palette (via `/` or the sidebar button) never lands back in Ask mode.
 */

import { create } from 'zustand';

interface CommandPaletteState {
  open: boolean;
  mode: 'command' | 'ask';
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setMode: (mode: 'command' | 'ask') => void;
  openAsk: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set, get) => ({
  open: false,
  mode: 'command',
  setOpen: (open) => set({ open, mode: open ? get().mode : 'command' }),
  toggle: () => set((state) => ({ open: !state.open })),
  setMode: (mode) => set({ mode }),
  openAsk: () => set({ open: true, mode: 'ask' }),
}));
