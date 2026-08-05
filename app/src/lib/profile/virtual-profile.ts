/**
 * Virtual profile helpers (refs #337).
 */

import type { Profile, VirtualProfile } from '../../api/types';

/**
 * How many of a group's members it can actually aggregate right now.
 *
 * The same two filters `useProfileScope` applies when it resolves a group's
 * scope: a member id that names no profile (deleted, or hand-edited storage)
 * and a member that is disabled both drop out. Shared rather than repeated at
 * each call site because a UI that counted members differently from the hook
 * that resolves them would offer a switch into an empty aggregate.
 *
 * Passing an already-enabled-only list is fine; the disabled filter is a no-op
 * then.
 */
export function countActiveMembers(group: VirtualProfile, profiles: Profile[]): number {
  const active = new Set(profiles.filter((p) => !p.disabled).map((p) => p.id));
  return group.memberProfileIds.filter((id) => active.has(id)).length;
}
