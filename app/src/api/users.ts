/**
 * Users API
 *
 * One call, for one purpose: finding out what the logged-in account may do.
 * ZoneMinder has no endpoint for "my permissions", so the closest thing is the
 * user list, which `UsersController` gates on `System() != 'None'`. An account
 * with no system access gets a 401 - and that refusal is itself the answer to
 * the only column it hides (refs #344).
 */

import type { ApiClient } from './client';
import type { ZMUsersResponse } from './types';
import { ZMUsersResponseSchema } from './types';
import { validateApiResponse } from '../lib/zm/api-validator';
import { isPermissionDenied } from '../lib/permissions/permission-error';
import {
  parsePermissionLevel,
  SYSTEM_NONE_PERMISSIONS,
  UNRESTRICTED_PERMISSIONS,
  type ZmPermissions,
} from '../lib/permissions/zm-permissions';
import { log, LogLevel } from '../lib/logger';

/**
 * Permissions for the account a profile logs in as.
 *
 * @param client - API client for the target profile
 * @param username - The profile's username; absent means the server has
 *   authentication turned off, where ZoneMinder allows everything
 * @returns The account's columns, `SYSTEM_NONE_PERMISSIONS` when the server
 *   refuses the list, or `undefined` when the list came back without a row for
 *   this account. Transport failures reject so the caller can retry.
 */
export async function fetchAccountPermissions(
  client: ApiClient,
  username: string | undefined,
): Promise<ZmPermissions | undefined> {
  if (!username) return UNRESTRICTED_PERMISSIONS;

  let response: ZMUsersResponse;
  try {
    const raw = await client.get<ZMUsersResponse>('/users.json', {
      intent: 'Read account permissions',
    });
    response = validateApiResponse(ZMUsersResponseSchema, raw.data, {
      endpoint: '/users.json',
      method: 'GET',
    });
  } catch (error) {
    if (isPermissionDenied(error)) {
      log.api('Account has no system access; permissions beyond System are unknown', LogLevel.INFO);
      return SYSTEM_NONE_PERMISSIONS;
    }
    throw error;
  }

  const wanted = username.toLowerCase();
  const row = response.users?.find((entry) => entry.User.Username.toLowerCase() === wanted)?.User;
  if (!row) {
    // The token maps to a name the profile does not store. Better to know
    // nothing than to gate this session on somebody else's row.
    log.api('No users.json row matches this profile; permissions stay unknown', LogLevel.WARN);
    return undefined;
  }

  return {
    system: parsePermissionLevel(row.System),
    monitors: parsePermissionLevel(row.Monitors),
    stream: parsePermissionLevel(row.Stream),
    events: parsePermissionLevel(row.Events),
    control: parsePermissionLevel(row.Control),
    groups: parsePermissionLevel(row.Groups),
  };
}
