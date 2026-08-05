/**
 * Reading the logged-in account's permissions off /users.json.
 *
 * The endpoint answers only for accounts with some system access, so the
 * refusal is as much a result as the payload is.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHttpError } from '../../lib/http/types';
import { SYSTEM_NONE_PERMISSIONS, UNRESTRICTED_PERMISSIONS } from '../../lib/permissions/zm-permissions';
import { fetchAccountPermissions } from '../users';
import type { ApiClient } from '../client';

/** One row as ZoneMinder 1.39 serializes it. */
function row(username: string, overrides: Record<string, string> = {}) {
  return {
    User: {
      Id: '2',
      Username: username,
      System: 'None',
      Monitors: 'View',
      Stream: 'View',
      Events: 'View',
      Control: 'None',
      Groups: 'View',
      ...overrides,
    },
  };
}

function clientReturning(data: unknown): ApiClient {
  return { get: vi.fn().mockResolvedValue({ data }) } as unknown as ApiClient;
}

function clientRejecting(error: unknown): ApiClient {
  return { get: vi.fn().mockRejectedValue(error) } as unknown as ApiClient;
}

const privilegeRefusal = createHttpError(
  401,
  'Unauthorized',
  { success: false, data: { name: 'Insufficient Privileges' } },
  {},
);

describe('fetchAccountPermissions', () => {
  it('returns the columns of the row matching the username', async () => {
    const client = clientReturning({
      users: [row('admin', { System: 'Edit' }), row('viewer')],
    });

    await expect(fetchAccountPermissions(client, 'viewer')).resolves.toEqual({
      system: 'None',
      monitors: 'View',
      stream: 'View',
      events: 'View',
      control: 'None',
      groups: 'View',
    });
  });

  it('matches the username case-insensitively', async () => {
    const client = clientReturning({ users: [row('Admin', { System: 'Edit' })] });

    await expect(fetchAccountPermissions(client, 'admin')).resolves.toMatchObject({ system: 'Edit' });
  });

  it('reports System None when the server refuses the list', async () => {
    // UsersController gates on System() != 'None', so the refusal itself
    // establishes the one column we could not read.
    await expect(fetchAccountPermissions(clientRejecting(privilegeRefusal), 'viewer')).resolves.toEqual(
      SYSTEM_NONE_PERMISSIONS,
    );
  });

  it('treats a profile with no username as an unauthenticated server', async () => {
    const client = clientReturning({ users: [] });

    await expect(fetchAccountPermissions(client, undefined)).resolves.toEqual(UNRESTRICTED_PERMISSIONS);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('leaves a column unknown when ZoneMinder omits it', async () => {
    const client = clientReturning({
      users: [{ User: { Username: 'viewer', System: 'View' } }],
    });

    await expect(fetchAccountPermissions(client, 'viewer')).resolves.toEqual({
      system: 'View',
      monitors: undefined,
      stream: undefined,
      events: undefined,
      control: undefined,
      groups: undefined,
    });
  });

  it('leaves System unknown when the value is not one ZoneMinder documents', async () => {
    // Denying on a level we failed to parse would lock an administrator out of
    // their own settings dialog.
    const client = clientReturning({ users: [{ User: { Username: 'viewer', System: 'Superuser' } }] });

    await expect(fetchAccountPermissions(client, 'viewer')).resolves.toMatchObject({ system: undefined });
  });

  it('gives up rather than guess when the account is not in the list', async () => {
    // Reachable when ZoneMinder maps the token to a different name than the
    // profile stores. Denying a surface on someone else's row would be worse
    // than knowing nothing.
    const client = clientReturning({ users: [row('someone-else')] });

    await expect(fetchAccountPermissions(client, 'viewer')).resolves.toBeUndefined();
  });

  it('propagates a transport failure so the query can retry', async () => {
    const offline = Object.assign(new Error('Failed to fetch'), { host: 'zm.local:443' });

    await expect(fetchAccountPermissions(clientRejecting(offline), 'viewer')).rejects.toThrow('Failed to fetch');
  });
});
