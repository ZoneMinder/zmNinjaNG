/**
 * Non-React accessors for the current profile's settings.
 *
 * API modules and other services run outside React and cannot use hooks.
 * These helpers used to read profile-scoped settings via useProfileStore and
 * useSettingsStore directly, but api/events.ts (and other api modules
 * downstream of stores/profile.ts) import this file, which formed a static
 * cycle back through stores/profile.ts. A gate is injected instead;
 * stores/profile.ts assembles the real implementation and registers it here
 * at module load. Refs #217.
 */

export interface ProfileSettingsGate {
  getExcludedMonitorIds(): string[];
}

let gate: ProfileSettingsGate = {
  // Safe default before the store registers: no monitors excluded.
  getExcludedMonitorIds: () => [],
};

export function setProfileSettingsGate(g: ProfileSettingsGate): void {
  gate = g;
}

/**
 * Get the excluded monitor IDs for the current profile.
 *
 * Returns an empty array if there is no current profile or if the stores are
 * not yet initialized.
 */
export function getExcludedMonitorIds(): string[] {
  try {
    return gate.getExcludedMonitorIds();
  } catch {
    // Ignore errors accessing the gate (e.g. during initialization)
  }
  return [];
}

/**
 * Get the excluded monitor IDs for the current profile as a Set, for O(1)
 * membership tests when filtering events/counts at the API boundary.
 */
export function getExcludedMonitorIdSet(): Set<string> {
  return new Set(getExcludedMonitorIds());
}
