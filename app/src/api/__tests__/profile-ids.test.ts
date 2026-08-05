/**
 * Virtual-profile id shape (refs #337).
 *
 * The predicates are the whole reason the ids are prefixed: guards in service
 * modules answer "is this an aggregate?" from the string alone.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_PROFILES_ID,
  PROBE_PROFILE_ID,
  asProfileId,
  isAggregateProfileId,
  isVirtualProfileId,
  mintVirtualProfileId,
} from '../types';

describe('virtual profile ids', () => {
  it('mints a unique prefixed id every call', () => {
    const a = mintVirtualProfileId();
    const b = mintVirtualProfileId();

    expect(a).not.toBe(b);
    expect(isVirtualProfileId(a)).toBe(true);
    expect(isVirtualProfileId(b)).toBe(true);
  });

  it('does not treat real, sentinel, or absent ids as virtual', () => {
    expect(isVirtualProfileId(asProfileId(crypto.randomUUID()))).toBe(false);
    expect(isVirtualProfileId(ALL_PROFILES_ID)).toBe(false);
    expect(isVirtualProfileId(PROBE_PROFILE_ID)).toBe(false);
    expect(isVirtualProfileId(null)).toBe(false);
    expect(isVirtualProfileId(undefined)).toBe(false);
  });

  it('counts both All Servers and virtual ids as aggregates, nothing else', () => {
    expect(isAggregateProfileId(ALL_PROFILES_ID)).toBe(true);
    expect(isAggregateProfileId(mintVirtualProfileId())).toBe(true);

    expect(isAggregateProfileId(asProfileId(crypto.randomUUID()))).toBe(false);
    expect(isAggregateProfileId(PROBE_PROFILE_ID)).toBe(false);
    expect(isAggregateProfileId(null)).toBe(false);
  });
});
