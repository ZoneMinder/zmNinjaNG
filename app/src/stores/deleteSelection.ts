/**
 * Transient selection of events queued for bulk deletion (refs #213). Session
 * only, not persisted. Cleared on cancel or after a successful bulk delete.
 */
import { create } from 'zustand';

interface DeleteSelectionState {
  selectedIds: string[];
  toggle: (eventId: string) => void;
  clear: () => void;
}

export const useDeleteSelectionStore = create<DeleteSelectionState>((set) => ({
  selectedIds: [],
  toggle: (eventId) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(eventId)
        ? s.selectedIds.filter((id) => id !== eventId)
        : [...s.selectedIds, eventId],
    })),
  clear: () => set({ selectedIds: [] }),
}));
