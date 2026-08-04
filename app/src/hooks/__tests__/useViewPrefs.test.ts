/**
 * View preferences resolve two-tier (refs #337): a monitor's own server owns
 * them in single mode, the ALL bucket owns them while aggregating, so one
 * toggle in the All Servers toolbar governs every tile regardless of which
 * server the tile came from.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewPrefs } from '../useViewPrefs';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';
import type { Profile } from '../../api/types';

const profile = (id: string): Profile => ({
  id: asProfileId(id),
  name: id,
  portalUrl: 'http://localhost',
  apiUrl: 'http://localhost/api',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: false,
  createdAt: 0,
});

describe('useViewPrefs', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [profile('profile-1'), profile('profile-2')],
      currentProfileId: asProfileId('profile-1'),
    });
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming', showAnalysisFrames: false },
        'profile-2': { ...DEFAULT_SETTINGS, viewMode: 'streaming', showAnalysisFrames: false },
        [ALL_PROFILES_ID]: {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
          showAnalysisFrames: true,
        },
      },
    });
  });

  it('reads the owning profile in single mode', () => {
    useSettingsStore.getState().updateProfileSettings('profile-2', {
      viewMode: 'snapshot',
      showAnalysisFrames: true,
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.viewMode).toBe('snapshot');
    expect(result.current.showAnalysisFrames).toBe(true);
  });

  it('falls back to the current profile when given no owner', () => {
    useSettingsStore.getState().updateProfileSettings('profile-1', { viewMode: 'snapshot' });

    const { result } = renderHook(() => useViewPrefs());

    expect(result.current.viewMode).toBe('snapshot');
  });

  it('lets the ALL bucket win over the owning profile in All mode', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    // profile-2 is on streaming with analysis off; the ALL bucket is not.
    expect(result.current.viewMode).toBe('snapshot');
    expect(result.current.showAnalysisFrames).toBe(true);
  });
});
