/**
 * Back-navigation decision for the event detail view.
 *
 * The events list and an open event are sibling routes, so opening an event
 * unmounts the list. `useScrollRestoration` restores the list's scroll position
 * by keying off the history entry's `location.key`. A real history POP reuses
 * that key and restores; a fresh `navigate(path)` PUSH mints a new key and
 * starts at the top. The back arrow must therefore POP whenever there is a
 * prior entry, matching Esc and the Android back button (refs #197).
 */

export type BackNavigation = { type: 'pop' } | { type: 'push'; to: string };

export function resolveBackNavigation(opts: {
  referrer?: string;
  historyLength: number;
}): BackNavigation {
  // A prior entry exists: pop to it so its scroll position is restored. Prev/next
  // event paging uses `replace`, so the previous entry is always the page the
  // user came from, never a paged-through event.
  if (opts.historyLength > 1) return { type: 'pop' };
  // Cold deep-link (notification tap, direct URL): nothing to pop, so push to
  // where we came from, or the events list as a last resort.
  return { type: 'push', to: opts.referrer ?? '/events' };
}
