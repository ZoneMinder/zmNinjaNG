/**
 * Tracks which profiles currently have a built session, mirroring
 * services/sessions.ts's cache as plain synchronous state.
 *
 * Kept in its own leaf module with no imports, so stores/auth.ts can read it
 * synchronously without forming an auth <-> services/sessions.ts load cycle
 * (sessions.ts imports api/store-gates.ts, which imports the auth store, so
 * auth must not import sessions.ts at module scope). Refs #337.
 */

const activeSessionIds = new Set<string>();

export function markSessionActive(profileId: string): void {
  activeSessionIds.add(profileId);
}

export function markSessionInactive(profileId: string): void {
  activeSessionIds.delete(profileId);
}

export function markAllSessionsInactive(): void {
  activeSessionIds.clear();
}

export function hasActiveSession(profileId: string): boolean {
  return activeSessionIds.has(profileId);
}
