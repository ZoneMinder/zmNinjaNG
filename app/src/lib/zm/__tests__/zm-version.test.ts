import { describe, it, expect } from 'vitest';
import { isZmVersionAtLeast } from '../zm-version';

describe('isZmVersionAtLeast', () => {
  it('returns false for null version', () => {
    expect(isZmVersionAtLeast(null, '1.38.0')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isZmVersionAtLeast('', '1.38.0')).toBe(false);
  });

  it('returns true when version equals target', () => {
    expect(isZmVersionAtLeast('1.38.0', '1.38.0')).toBe(true);
  });

  it('returns true when version is above target', () => {
    expect(isZmVersionAtLeast('1.38.1', '1.38.0')).toBe(true);
    expect(isZmVersionAtLeast('1.39.0', '1.38.0')).toBe(true);
    expect(isZmVersionAtLeast('2.0.0', '1.38.0')).toBe(true);
  });

  it('returns false when version is below target', () => {
    expect(isZmVersionAtLeast('1.37.99', '1.38.0')).toBe(false);
    expect(isZmVersionAtLeast('1.36.0', '1.38.0')).toBe(false);
    expect(isZmVersionAtLeast('0.99.99', '1.38.0')).toBe(false);
  });

  it('handles versions without patch number', () => {
    expect(isZmVersionAtLeast('1.38', '1.38.0')).toBe(true);
    expect(isZmVersionAtLeast('1.37', '1.38.0')).toBe(false);
  });

  it('handles multi-digit version segments', () => {
    expect(isZmVersionAtLeast('1.38.10', '1.38.9')).toBe(true);
    expect(isZmVersionAtLeast('1.38.9', '1.38.10')).toBe(false);
  });
});
