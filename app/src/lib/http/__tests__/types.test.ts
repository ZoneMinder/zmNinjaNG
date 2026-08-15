import { describe, it, expect } from 'vitest';
import { createHttpError, isNotFound } from '../types';

describe('isNotFound', () => {
  it('recognises a record the server no longer has', () => {
    expect(isNotFound(createHttpError(404, 'Not Found', {}, {}))).toBe(true);
  });

  it('leaves every other failure to its own handler', () => {
    expect(isNotFound(createHttpError(401, 'Unauthorized', {}, {}))).toBe(false);
    expect(isNotFound(createHttpError(500, 'Server Error', {}, {}))).toBe(false);
  });

  it('says no to anything it cannot read a status from', () => {
    expect(isNotFound(new Error('Failed to fetch'))).toBe(false);
    expect(isNotFound('404')).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
