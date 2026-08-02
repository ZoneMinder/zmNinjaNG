/**
 * Scoped result wrappers for All-mode aggregation hooks.
 *
 * A scoped hook (e.g. useScopedMonitors) fans a query out over every profile
 * in the active scope (see useProfileScope) and merges the per-profile
 * results into one list. Each item keeps the profile it came from so
 * colliding ids across servers (monitor "1" on profile A and profile B)
 * stay distinct entries and the UI can label/route them correctly.
 */

import type { ProfileId } from './types';

export interface Scoped<T> {
  profileId: ProfileId;
  profileName: string;
  item: T;
}

export interface ProfileError {
  profileId: ProfileId;
  profileName: string;
  error: unknown;
}
