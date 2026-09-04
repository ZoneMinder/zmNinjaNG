/**
 * useMonitorFlag: one profile-scoped id list per flag, so the fullscreen
 * memory and the mute memory never read each other's entries (refs #463).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { asProfileId } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { useMonitorFlag } from '../useMonitorFlag';

const HOME = asProfileId('home');

describe('useMonitorFlag', () => {
  beforeEach(() => seedProfiles(['home'], { current: 'home' }));
  afterEach(resetProfileFixture);

  it('keeps the fullscreen and unmuted lists apart', () => {
    const fs = renderHook(() => useMonitorFlag(HOME, '1', 'fullscreenMonitorIds'));
    act(() => fs.result.current[1](true));

    expect(useSettingsStore.getState().getProfileSettings(HOME).fullscreenMonitorIds).toEqual(['1']);
    expect(useSettingsStore.getState().getProfileSettings(HOME).unmutedMonitorIds).toEqual([]);
    expect(renderHook(() => useMonitorFlag(HOME, '1', 'unmutedMonitorIds')).result.current[0]).toBe(false);

    act(() => fs.result.current[1](false));
    expect(fs.result.current[0]).toBe(false);
  });
});
