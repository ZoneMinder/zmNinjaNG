import { describe, it, expect } from 'vitest';
import { shouldRetryQuery } from '../query-cache';

function httpError(status: number): Error {
  const error = new Error(`HTTP ${status}: error`) as Error & { status: number };
  error.status = status;
  return error;
}

describe('shouldRetryQuery', () => {
  it('never retries a 401', () => {
    expect(shouldRetryQuery(0, httpError(401))).toBe(false);
    expect(shouldRetryQuery(1, httpError(401))).toBe(false);
  });

  it('never retries a 403', () => {
    expect(shouldRetryQuery(0, httpError(403))).toBe(false);
    expect(shouldRetryQuery(1, httpError(403))).toBe(false);
  });

  it('retries a 500 exactly once', () => {
    expect(shouldRetryQuery(0, httpError(500))).toBe(true);
    expect(shouldRetryQuery(1, httpError(500))).toBe(false);
  });

  it('retries a network error (no status) exactly once', () => {
    const error = new Error('Network request failed');
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(false);
  });

  it('handles non-Error values without throwing', () => {
    expect(shouldRetryQuery(0, undefined)).toBe(true);
    expect(shouldRetryQuery(0, null)).toBe(true);
    expect(shouldRetryQuery(1, 'boom')).toBe(false);
  });
});
