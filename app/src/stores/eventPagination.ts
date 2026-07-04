/**
 * Transient store of the "Load More" event count, keyed by a filter signature.
 *
 * /events and /events/:id are sibling routes, so opening an event unmounts the
 * Events list and returning remounts it. Without this, the pagination count
 * (component state) reset to the first page on return: the list collapsed from,
 * say, 300 events back to 100. That dropped the return-highlight arrow (the
 * viewed row was no longer rendered) and clamped scroll restoration to the
 * shorter list (refs #197).
 *
 * The count is remembered against a signature identifying the current result set
 * (profile + filters). Returning with the same signature rehydrates the count;
 * changing a filter produces a new signature and starts back at page one.
 * Session-only, not persisted. Not subscribed reactively: callers read via
 * getState() so the store never triggers re-renders.
 */
import { create } from 'zustand';

interface EventPaginationState {
  signature: string | null;
  limit: number | null;
  remember: (signature: string, limit: number) => void;
  /** Returns the remembered limit if the signature matches, else null. */
  recall: (signature: string) => number | null;
}

export const useEventPaginationStore = create<EventPaginationState>((set, get) => ({
  signature: null,
  limit: null,
  remember: (signature, limit) => set({ signature, limit }),
  recall: (signature) => {
    const state = get();
    return state.signature === signature ? state.limit : null;
  },
}));
