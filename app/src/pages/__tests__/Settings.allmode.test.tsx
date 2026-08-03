import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Settings from '../Settings';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

const updateProfileSettings = vi.fn();

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
  useProfileById: vi.fn(),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../stores/settings', () => ({
  DEFAULT_SETTINGS: { viewMode: 'snapshot', tvMode: false },
  HOVER_PREVIEW_PLAYBACK_RATES: [50, 100, 150, 200, 400],
  DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE: 200,
  useSettingsStore: (selector: (state: { updateProfileSettings: typeof updateProfileSettings }) => unknown) =>
    selector({ updateProfileSettings }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" {...props} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));
vi.mock('../../components/settings/HiddenMonitorsSection', () => ({
  HiddenMonitorsSection: () => null,
}));
// AssistantSection and AdvancedSection pull in WebGPU/model-download/native-LLM
// probes and other effects unrelated to this test's two-tier-picker subject,
// which fire post-assert and produce act() noise. Stub them the same way.
vi.mock('../../components/settings/AssistantSection', () => ({
  AssistantSection: () => null,
}));
vi.mock('../../components/settings/AdvancedSection', () => ({
  AdvancedSection: () => null,
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home' } as import('../../api/types').Profile;
const profileB = { id: asProfileId('profile-b'), name: 'Work' } as import('../../api/types').Profile;
const baseSettings = {
  viewMode: 'snapshot', tvMode: false, dateFormat: 'MMM d, yyyy', timeFormat: '12h',
  customDateFormat: '', customTimeFormat: '', thumbnailFallbackChain: [], hoverPreview: {},
  hoverPreviewPlaybackRate: 200,
};

describe('Settings page - All mode two-tier picker (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null, isAllMode: true, hasProfile: false,
      settings: baseSettings as never,
    });
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: baseSettings as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', profile: null, profiles: [profileA, profileB], settings: baseSettings as never,
    });
  });

  it('AppearanceSection (view-level) writes to the ALL bucket, not a real profile', async () => {
    render(<Settings />);

    await screen.findByTestId('settings-tv-mode');
    fireEvent.click(screen.getByTestId('settings-tv-mode'));

    expect(updateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, { tvMode: true });
  });

  it('shows the picker above the server-scoped block, defaulted to the first profile', () => {
    render(<Settings />);
    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
  });
});
