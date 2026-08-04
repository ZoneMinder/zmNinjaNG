/**
 * Analysis-frames toggle (refs #337): it is a view preference, so All mode
 * reads and writes the ALL bucket rather than being disabled because no
 * single profile is current.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalysisFramesToggle } from '../AnalysisFramesToggle';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../../stores/settings';
import { ALL_PROFILES_ID, asProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const profile = (id: string): Profile => ({
  id: asProfileId(id),
  name: id,
  portalUrl: 'http://localhost',
  apiUrl: 'http://localhost/api',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: false,
  createdAt: 0,
});

const bucket = (id: string) => useSettingsStore.getState().getProfileSettings(id);

describe('AnalysisFramesToggle', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [profile('profile-1'), profile('profile-2')],
      currentProfileId: asProfileId('profile-1'),
    });
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming' },
      },
    });
  });

  it('writes to the current profile in single mode', () => {
    render(<AnalysisFramesToggle />);

    fireEvent.click(screen.getByTestId('analysis-frames-toggle'));

    expect(bucket('profile-1').showAnalysisFrames).toBe(true);
  });

  it('is enabled in All mode and writes to the ALL bucket', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      viewMode: 'streaming',
    });

    render(<AnalysisFramesToggle />);
    const toggle = screen.getByTestId('analysis-frames-toggle');
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);

    expect(bucket(ALL_PROFILES_ID).showAnalysisFrames).toBe(true);
    expect(screen.getByTestId('analysis-frames-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('stays disabled while the governing bucket is on snapshot', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      viewMode: 'snapshot',
    });

    render(<AnalysisFramesToggle />);

    expect(screen.getByTestId('analysis-frames-toggle')).toBeDisabled();
  });
});
