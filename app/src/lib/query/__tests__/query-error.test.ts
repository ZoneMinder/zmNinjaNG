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

  // "Log in again" is useless advice when the session is fine and the account
  // simply may not do this (refs #344).
  it('distinguishes a privilege refusal from an expired session', () => {
    const err = createHttpError(401, 'Unauthorized', {
      success: false,
      data: { name: 'Insufficient Privileges' },
    }, {});
    expect(resolveQueryError(err, t)).toBe('common.permission_denied');
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

  // A connection failure never got a response, so it carries no status. The
  // host comes off the error (stamped by lib/http.ts from the URL it dialled),
  // never out of the platform's own prose: Android says "failed to connect to
  // /192.168.50.11 (port 11434)", Electron "connect ECONNREFUSED ...", iOS
  // "Could not connect to the server", and browser fetch "Failed to fetch"
  // with no address at all (refs #312).
  describe('unreachable host', () => {
    it('names the host instead of echoing the platform message', () => {
      const err = Object.assign(new Error('failed to connect to /192.168.50.11 (port 11434)'), {
        host: '192.168.50.11:11434',
      });
      expect(resolveQueryError(err, t)).toBe(
        'common.cannot_reach_host:{"host":"192.168.50.11:11434"}'
      );
    });

    // Same verdict whatever the platform said, because the check is structural.
    it('gives the same answer for every platform wording', () => {
      for (const message of [
        'failed to connect to /192.168.50.11 (port 11434)',
        'connect ECONNREFUSED 192.168.50.11:11434',
        'Could not connect to the server.',
        'Failed to fetch',
      ]) {
        const err = Object.assign(new Error(message), { host: '192.168.50.11:11434' });
        expect(resolveQueryError(err, t)).toBe(
          'common.cannot_reach_host:{"host":"192.168.50.11:11434"}'
        );
      }
    });

    // The fallbackKey must not win over it: "Ninjii error: failed to connect
    // to /..." is exactly the string this replaces.
    it('outranks the caller fallbackKey', () => {
      const err = Object.assign(new Error('failed to connect to /192.168.50.11 (port 11434)'), {
        host: '192.168.50.11:11434',
      });
      expect(resolveQueryError(err, t, { fallbackKey: 'assistant.error_generic' })).toBe(
        'common.cannot_reach_host:{"host":"192.168.50.11:11434"}'
      );
    });

    // A user-initiated cancellation also carries no status. It is not a
    // connection failure and must not be reported as one; `isTimeoutError`
    // folds aborts in, which is why it is the wrong helper here.
    it('leaves an aborted request alone', () => {
      const err = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
        host: '192.168.50.11:11434',
      });
      expect(resolveQueryError(err, t, { fallbackKey: 'assistant.error_generic' })).toBe(
        'assistant.error_generic:{"error":"The operation was aborted"}'
      );
    });

    // Without a host there is nothing better to say than before, so the
    // existing behaviour stands rather than inventing a vaguer message.
    it('falls back unchanged when no host was stamped', () => {
      const err = new Error('Something else broke');
      expect(resolveQueryError(err, t)).toBe('common.error: Something else broke');
    });

    // An HTTP error DID get a response, so it is not an unreachable host even
    // though its message may mention connections.
    it('does not fire for a real HTTP status', () => {
      const err = Object.assign(createHttpError(500, 'Server Error', null, {}), {
        host: '192.168.50.11:11434',
      });
      expect(resolveQueryError(err, t)).toBe('common.error: HTTP 500: Server Error');
    });
  });
});
