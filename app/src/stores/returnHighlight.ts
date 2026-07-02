/**
 * Transient store of the last event a user opened from a list, so the list can
 * flag that row when the user returns (refs #213). Session-only, not persisted.
 */
import { create } from 'zustand';

interface ReturnHighlightState {
  lastViewedEventId: string | null;
  markViewed: (eventId: string) => void;
  clear: () => void;
}

export const useReturnHighlightStore = create<ReturnHighlightState>((set) => ({
  lastViewedEventId: null,
  markViewed: (eventId) => set({ lastViewedEventId: eventId }),
  clear: () => set({ lastViewedEventId: null }),
}));
