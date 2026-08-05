/**
 * useProfileScope Hook
 *
 * Resolves the active scope for data-fetching consumers: either a single
 * profile or an aggregate over several. `profiles` is always an array so
 * consumers fan out over `scope.profiles` identically in both modes, with no
 * branches.
 *
 * An aggregate is a virtual profile: a stored, named group over its own
 * members. Consumers ask "am I aggregating", never "which aggregate", so it
 * resolves to `mode: 'all'` with its own `aggregateId`/`aggregateName`.
 *
 * The retired All Servers sentinel still resolves here (every enabled
 * profile, no stored name). It is unreachable through the UI and migrated
 * away on rehydrate, so this arm only fires for a stored id that has not been
 * through the migration yet - state written by another tab running an older
 * build, say. Keeping it means such a frame renders an aggregate rather than
 * an empty screen. Refs #337.
 *
 * IMPORTANT: mirrors useCurrentProfile's selector discipline: stable
 * primitives from the profile store, useShallow for arrays/objects, and
 * settings merged inside useMemo. Do NOT call getProfileSettings() inside a
 * selector; it allocates a new object on every call and causes infinite
 * re-renders.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, mergeProfileSettings } from '../stores/settings';
import { ALL_PROFILES_ID, isAggregateProfileId, isVirtualProfileId } from '../api/types';
import type { Profile, ProfileId } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

export type ProfileScope =
  | { mode: 'single'; profile: Profile; profiles: [Profile]; settings: ProfileSettings }
  | {
      mode: 'all';
      profile: null;
      profiles: Profile[];
      settings: ProfileSettings;
      /** Which aggregate is active: the All Servers sentinel or a virtual
       *  profile's id. The key of the settings bucket this scope reads. */
      aggregateId: ProfileId;
      /** The group's stored name, or null for All Servers - it has no stored
       *  name, so consumers render their own localized label. */
      aggregateName: string | null;
    };

/**
 * Hook to get the active profile scope.
 *
 * @returns The active scope, or null when no profile is selected.
 */
export function useProfileScope(): ProfileScope | null {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  // Fallback lives inside the selector so useShallow can dedupe repeated
  // empty-array snapshots to the same reference; a `?? []` applied outside
  // the selector allocates a new array every render and defeats the
  // useMemo below (react-hooks/exhaustive-deps).
  const profiles = useProfileStore(useShallow((state) => state.profiles ?? []));
  // Raw slice, same discipline as `profiles` above: the `?? []` lives inside
  // the selector so useShallow dedupes repeated empty snapshots, and the
  // member resolution happens in a useMemo below rather than in the selector
  // (a selector that minted the resolved array would loop the render).
  const virtualProfiles = useProfileStore(useShallow((state) => state.virtualProfiles ?? []));

  const isAllMode = isAggregateProfileId(currentProfileId);

  // Disabled profiles are excluded from every aggregate. This is the single
  // filter every aggregate surface inherits (monitors, events, badges,
  // notification overview, pickers, token refresh) since they all fan out
  // over scope.profiles rather than the raw store list. Refs #337.
  const enabledProfiles = useMemo(() => profiles.filter((p) => !p.disabled), [profiles]);

  // The active group, when the current id names one. An id with no group
  // behind it (deleted in another tab, hand-edited storage) resolves to null
  // and collapses the scope below, the same as a group with no members left.
  const virtualProfile = useMemo(
    () =>
      isVirtualProfileId(currentProfileId)
        ? (virtualProfiles.find((v) => v.id === currentProfileId) ?? null)
        : null,
    [virtualProfiles, currentProfileId]
  );

  // What this aggregate actually fans out over. Membership is filtered on
  // read as well as pruned on write: unknown and disabled member ids are
  // dropped here, so hand-edited storage cannot make a group name a server
  // the user disabled or deleted. Filtering `enabledProfiles` (rather than
  // mapping over the member list) also keeps the result in profile-list
  // order, so a group's tiles sit in the same order as All mode's.
  const aggregateProfiles = useMemo(() => {
    // All Servers: every enabled profile, unfiltered.
    if (!isVirtualProfileId(currentProfileId)) return enabledProfiles;
    if (!virtualProfile) return [];
    const members = new Set<string>(virtualProfile.memberProfileIds);
    return enabledProfiles.filter((p) => members.has(p.id));
  }, [currentProfileId, virtualProfile, enabledProfiles]);

  const currentProfile = useMemo(() => {
    const found = profiles.find((p) => p.id === currentProfileId) ?? null;
    // A disabled profile can never be current in normal operation -
    // switchProfile's guard rejects switching to one. This only matters if
    // persisted state is ever edited externally to hold a disabled profile
    // as current; treat that the same as "no profile selected" so it routes
    // to the setup redirect like any other unresolvable current id.
    return found && !found.disabled ? found : null;
  }, [profiles, currentProfileId]);

  // Select the RAW profile settings object - NOT the getProfileSettings
  // function, which creates a new object on every call. useShallow ensures
  // shallow comparison. Every aggregate's bucket lives in the same
  // profileSettings map under its own id - the ALL sentinel or a virtual
  // profile's id - so this key is just currentProfileId in all three modes,
  // and a group's settings are independent of the All bucket by construction.
  const rawSettings = useSettingsStore(useShallow((state) => state.profileSettings?.[currentProfileId ?? '']));

  const settings = useMemo((): ProfileSettings => mergeProfileSettings(rawSettings), [rawSettings]);

  return useMemo((): ProfileScope | null => {
    if (isAllMode) {
      // Deleting profiles one-by-one while in All mode can leave the
      // sentinel selected with zero real profiles left (deleteProfile only
      // resets currentProfileId when it equals the deleted id, never for
      // the sentinel). Collapse to null so it means "nothing to show, route
      // to setup" uniformly in both modes (refs #337). Same collapse
      // applies when every remaining profile is disabled, and to a group
      // whose members have all been deleted or disabled.
      if (aggregateProfiles.length === 0) return null;
      return {
        mode: 'all',
        profile: null,
        profiles: aggregateProfiles,
        settings,
        aggregateId: currentProfileId ?? ALL_PROFILES_ID,
        aggregateName: virtualProfile?.name ?? null,
      };
    }
    if (!currentProfile) return null;
    return { mode: 'single', profile: currentProfile, profiles: [currentProfile], settings };
  }, [isAllMode, aggregateProfiles, currentProfile, settings, currentProfileId, virtualProfile]);
}
