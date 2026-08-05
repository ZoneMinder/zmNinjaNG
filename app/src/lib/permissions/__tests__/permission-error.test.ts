/**
 * Telling "you may not" apart from "log in again".
 *
 * Both arrive as HTTP 401. Treating a permission refusal as an expired session
 * costs a token refresh and a retry per attempt, and ends in a message about
 * the server failing rather than about the account.
 */

import { describe, it, expect } from 'vitest';
import { createHttpError } from '../../http/types';
import { isPermissionDenied } from '../permission-error';

/** Verbatim body from ZoneMinder 1.39.18 for a refused write. */
const insufficientPrivileges = {
  success: false,
  data: {
    name: 'Insufficient Privileges',
    message: 'Insufficient Privileges',
    url: '/zm/api/monitors/1.json',
    exception: { class: 'UnauthorizedException', code: 401, message: 'Insufficient Privileges' },
  },
};

/** Verbatim body from the same server when the token is missing or stale. */
const notAuthenticated = {
  success: false,
  data: {
    name: 'Not Authenticated',
    message: 'Not Authenticated',
    url: '/zm/api/users.json',
    exception: { class: 'UnauthorizedException', code: 401, message: 'Not Authenticated' },
  },
};

describe('isPermissionDenied', () => {
  it('recognizes a ZoneMinder privilege refusal', () => {
    expect(isPermissionDenied(createHttpError(401, 'Unauthorized', insufficientPrivileges, {}))).toBe(true);
  });

  it('does not claim an unauthenticated 401 is a permission problem', () => {
    // This one MUST still reach the token-refresh path or a stale session
    // never recovers.
    expect(isPermissionDenied(createHttpError(401, 'Unauthorized', notAuthenticated, {}))).toBe(false);
  });

  it('ignores a 401 with no ZoneMinder body to read', () => {
    expect(isPermissionDenied(createHttpError(401, 'Unauthorized', undefined, {}))).toBe(false);
    expect(isPermissionDenied(createHttpError(401, 'Unauthorized', 'Unauthorized', {}))).toBe(false);
  });

  it('ignores other statuses and non-errors', () => {
    expect(isPermissionDenied(createHttpError(500, 'Server Error', insufficientPrivileges, {}))).toBe(false);
    expect(isPermissionDenied(new Error('boom'))).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
  });

  it('reads the message off the exception when the name is missing', () => {
    const body = { success: false, data: { exception: { message: 'Insufficient privileges' } } };
    expect(isPermissionDenied(createHttpError(401, 'Unauthorized', body, {}))).toBe(true);
  });
});
