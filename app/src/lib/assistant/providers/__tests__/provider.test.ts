import { describe, it, expect, vi, afterEach } from 'vitest';
import { isAssistantTestMode, getAssistantProvider } from '../provider';
import { sharedMockProvider } from '../mock';
import { STORAGE_KEYS } from '../../../zmninja-ng-constants';

describe('isAssistantTestMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('returns false in production even when the localStorage flag is set', () => {
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');
    vi.stubEnv('PROD', true);

    expect(isAssistantTestMode()).toBe(false);
  });

  it('returns true outside production when the flag is set', () => {
    vi.stubEnv('PROD', false);
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');

    expect(isAssistantTestMode()).toBe(true);
  });

  it('returns false outside production when the flag is absent', () => {
    vi.stubEnv('PROD', false);

    expect(isAssistantTestMode()).toBe(false);
  });

  it('returns false instead of throwing when localStorage access throws', () => {
    vi.stubEnv('PROD', false);
    const original = global.localStorage.getItem;
    vi.spyOn(global.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(isAssistantTestMode()).toBe(false);

    global.localStorage.getItem = original;
  });
});

describe('getAssistantProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('returns the shared mock provider in test mode', () => {
    vi.stubEnv('PROD', false);
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');

    expect(getAssistantProvider()).toBe(sharedMockProvider);
  });

  it('throws when not in test mode', () => {
    vi.stubEnv('PROD', false);

    expect(() => getAssistantProvider()).toThrow('On-device model backend is not available yet.');
  });

  it('throws in production even if the localStorage flag is set', () => {
    vi.stubEnv('PROD', true);
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');

    expect(() => getAssistantProvider()).toThrow('On-device model backend is not available yet.');
  });
});
