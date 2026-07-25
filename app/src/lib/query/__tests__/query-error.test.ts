import { describe, it, expect } from 'vitest';
import { resolveQueryError } from '../query-error';
import { createHttpError } from '../../http/types';
import type { TFunction } from 'i18next';

// Minimal t stub: returns the key (with interpolation values appended),
// matching how the real resolveQueryError callers only care about the key
// and options passed through.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe('resolveQueryError', () => {
  it('returns the auth_required key for a 401 status', () => {
    const err = { message: 'Request failed', status: 401 };
    expect(resolveQueryError(err, t)).toBe('common.auth_required');
  });

  // The native adapter reports no status text, so the message alone carries
  // nothing for the "unauthorized" regex to match. Only the status does.
  it('returns the auth_required key for a native 401 with no status text', () => {
    const err = createHttpError(401, '', null, {});
    expect(err.message).toBe('HTTP 401');
    expect(resolveQueryError(err, t)).toBe('common.auth_required');
  });

  it('returns the auth_required key when the message says unauthorized', () => {
    const err = new Error('Unauthorized: token expired');
    expect(resolveQueryError(err, t)).toBe('common.auth_required');
  });

  it('is case-insensitive when matching "unauthorized" in the message', () => {
    const err = new Error('UNAUTHORIZED');
    expect(resolveQueryError(err, t)).toBe('common.auth_required');
  });

  it('falls back to "common.error: message" with no fallbackKey option', () => {
    const err = new Error('Network down');
    expect(resolveQueryError(err, t)).toBe('common.error: Network down');
  });

  it('uses the fallbackKey option with the error interpolated when provided', () => {
    const err = new Error('Network down');
    expect(resolveQueryError(err, t, { fallbackKey: 'monitors.failed_to_load' })).toBe(
      'monitors.failed_to_load:{"error":"Network down"}'
    );
  });

  it('uses common.unknown_error when the error has no message', () => {
    const err = {};
    expect(resolveQueryError(err, t)).toBe('common.error: common.unknown_error');
  });

  it('does not treat a non-401 status as auth-required', () => {
    const err = { message: 'Server error', status: 500 };
    expect(resolveQueryError(err, t)).toBe('common.error: Server error');
  });
});
