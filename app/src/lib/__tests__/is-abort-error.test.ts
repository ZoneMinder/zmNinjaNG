import { describe, it, expect } from 'vitest';
import { isAbortError } from '../is-abort-error';

describe('isAbortError', () => {
  it('detects a DOMException-style abort (does not extend Error in browsers)', () => {
    // Simulate a browser DOMException that is not an Error instance.
    const domLike = { name: 'AbortError', message: 'The operation was aborted.' };
    expect(domLike instanceof Error).toBe(false);
    expect(isAbortError(domLike)).toBe(true);
  });

  it('detects an Error named AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('detects a real DOMException named AbortError', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('returns false for a non-abort error', () => {
    expect(isAbortError(new Error('network down'))).toBe(false);
    expect(isAbortError({ name: 'TypeError' })).toBe(false);
  });

  it('returns false for null, undefined, and primitives', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });
});
