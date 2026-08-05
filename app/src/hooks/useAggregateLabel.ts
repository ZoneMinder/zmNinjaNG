/**
 * useAggregateLabel
 *
 * The name to show for any aggregate id: a group's own stored name, or the
 * localized "All Servers" for the retired sentinel, which has no stored name.
 * That arm is legacy - the sentinel is unreachable and migrated away on
 * rehydrate - and stays so a pre-migration frame names what it is showing.
 *
 * Resolves by id rather than from the active scope because the callers name an
 * aggregate they are not in yet - the switcher and the Profiles page both
 * announce the aggregate they are switching TO. `useProfileScope().aggregateName`
 * stays the right answer for labelling the aggregate already active. Refs #337.
 *
 * Only the sentinel answers "All Servers". A group id with nothing stored
 * behind it (deleted in another tab, hand-edited storage) aggregates nothing -
 * useProfileScope collapses it to null - so it falls back to the same "no
 * selection" label the switcher shows with no profile chosen, rather than
 * claiming a selection the user does not have.
 */

import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../stores/profile';
import { ALL_PROFILES_ID } from '../api/types';
import type { ProfileId } from '../api/types';

export function useAggregateLabel(): (id: ProfileId | string | null) => string {
  const { t } = useTranslation();
  // Raw slice with the `?? []` inside the selector, so useShallow dedupes
  // repeated empty snapshots to one reference (see useProfileScope).
  const virtualProfiles = useProfileStore(useShallow((state) => state.virtualProfiles ?? []));

  return (id) => {
    if (id === ALL_PROFILES_ID) return t('profiles.all_servers');
    return virtualProfiles.find((v) => v.id === id)?.name ?? t('profiles.select_profile');
  };
}
