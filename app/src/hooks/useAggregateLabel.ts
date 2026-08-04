/**
 * useAggregateLabel
 *
 * The name to show for any aggregate id: a group's own stored name, or the
 * localized "All Servers" for the built-in sentinel, which has no stored name.
 *
 * Resolves by id rather than from the active scope because the callers name an
 * aggregate they are not in yet - the switcher and the Profiles page both
 * announce the aggregate they are switching TO. `useProfileScope().aggregateName`
 * stays the right answer for labelling the aggregate already active. Refs #337.
 */

import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../stores/profile';
import type { ProfileId } from '../api/types';

export function useAggregateLabel(): (id: ProfileId | string | null) => string {
  const { t } = useTranslation();
  // Raw slice with the `?? []` inside the selector, so useShallow dedupes
  // repeated empty snapshots to one reference (see useProfileScope).
  const virtualProfiles = useProfileStore(useShallow((state) => state.virtualProfiles ?? []));

  return (id) => virtualProfiles.find((v) => v.id === id)?.name ?? t('profiles.all_servers');
}
