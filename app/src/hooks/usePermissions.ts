/**
 * usePermissions Hook
 *
 * What the given profile's ZoneMinder account may do, probed once per profile
 * and cached for the session. Surfaces read a verdict from
 * `lib/permissions/zm-permissions.ts` rather than the raw columns.
 *
 * Takes an explicit profile id because an aggregate has no account of its own:
 * in All mode each monitor, event, and stream belongs to a real profile, and
 * that owner's permissions are the ones that decide what its controls can do.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchAccountPermissions } from '../api/users';
import { getSession } from '../services/sessions';
import { useProfileStore } from '../stores/profile';
import { useAuthSlice } from '../stores/auth';
import { queryKeys } from '../lib/query/query-keys';
import { isAggregateProfileId } from '../api/types';
import { isPermissionDenied } from '../lib/permissions/permission-error';
import type { ProfileId } from '../api/types';
import type { ZmPermissions } from '../lib/permissions/zm-permissions';

export interface UsePermissionsReturn {
  /** The account's columns, or undefined while unknown. */
  permissions: ZmPermissions | undefined;
  /** True until the probe settles. Surfaces stay optimistic meanwhile. */
  isLoading: boolean;
}

/**
 * @param profileId - A real profile id. An aggregate id yields no permissions:
 *   ask for the owning profile of whatever is on screen instead.
 */
export function usePermissions(profileId: ProfileId | null | undefined): UsePermissionsReturn {
  const isReal = !!profileId && !isAggregateProfileId(profileId);
  const isAuthenticated = useAuthSlice(isReal ? profileId : null).isAuthenticated;
  // A primitive, so this subscription re-renders on a credential change and
  // on nothing else.
  const username = useProfileStore((state) =>
    isReal ? state.profiles.find((p) => p.id === profileId)?.username : undefined,
  );

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.accountPermissions(profileId),
    queryFn: () => fetchAccountPermissions(getSession(profileId!).client, username),
    enabled: isReal && isAuthenticated,
    // Permissions change when an administrator edits the account, which this
    // app cannot observe and the user cannot do from here. One probe per
    // session is the whole budget.
    staleTime: Infinity,
    gcTime: Infinity,
    // A refusal is an answer, not a failure; retrying it would spend requests
    // to be told the same thing. Transport failures still get the default
    // retry, and leave every verdict at "unknown" until one succeeds.
    retry: (failureCount, error) => !isPermissionDenied(error) && failureCount < 2,
  });

  return { permissions: data, isLoading };
}
