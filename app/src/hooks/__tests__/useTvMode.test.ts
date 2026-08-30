import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));
vi.mock('../../lib/platform', () => ({
  Platform: { isNative: false },
}));

import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';

// Runs against the real profile and settings stores; only the platform check
// is mocked.
describe('useTvMode', () => {
  afterEach(() => {
    resetProfileFixture();
  });

  it('returns false when tvMode setting is off', async () => {
    seedProfiles(['test']);
    const { useTvMode } = await import('../useTvMode');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useTvMode());
    expect(result.current.isTvMode).toBe(false);
  });

  it('returns true when tvMode setting is on', async () => {
    seedProfiles(['test'], { settings: { test: { tvMode: true } } });
    const { useTvMode } = await import('../useTvMode');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useTvMode());
    expect(result.current.isTvMode).toBe(true);
  });
});
