import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Settings from '../Settings';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';
import { DEFAULT_SETTINGS } from '../../stores/settings';

const updateProfileSettings = vi.fn();

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
  useProfileById: vi.fn(),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
// What the ALL bucket holds for the All Servers Streaming Mode. 'per-server'
// is its default: each server keeps its own Streaming Mode.
let allModeViewMode = 'per-server';
// Everything except the store itself stays REAL: the All Servers performance
// section reads DEFAULT_SETTINGS to decide what "back to default" means, and a
// hand-written stub of that would assert against the stub rather than against
// what the app ships.
vi.mock('../../stores/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/settings')>()),
  useSettingsStore: (
    selector: (state: { updateProfileSettings: typeof updateProfileSettings }) => unknown
  ) => selector({ updateProfileSettings }),
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
  ...DEFAULT_SETTINGS,
  viewMode: 'snapshot', tvMode: false, dateFormat: 'MMM d, yyyy', timeFormat: '12h',
  customDateFormat: '', customTimeFormat: '', thumbnailFallbackChain: [], hoverPreview: {},
  hoverPreviewPlaybackRate: 200,
};

describe('Settings page - All mode two-tier picker (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allModeViewMode = 'per-server';
    // mockImplementation, not mockReturnValue: allModeViewMode is mutated
    // between renders inside a test, and a captured object would not see it.
    vi.mocked(useCurrentProfile).mockImplementation(() => ({
      currentProfile: null, isAllMode: true, hasProfile: false,
      settings: { ...baseSettings, allModeViewMode } as never,
    }));
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: baseSettings as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', aggregateId: ALL_PROFILES_ID, aggregateName: null, profile: null, profiles: [profileA, profileB], settings: baseSettings as never,
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

  // The All-Servers Streaming Mode row: without it the ALL bucket's viewMode
  // is unwritable, and the stream path's two-tier read has no way to be told
  // anything but "follow each server" (refs #337).
  describe('All Servers Streaming Mode', () => {
    it('imposes streaming on every server when picked', () => {
      render(<Settings />);

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-streaming'));

      expect(updateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, {
        allModeViewMode: 'streaming',
      });
    });

    it('imposes snapshot on every server when picked', () => {
      render(<Settings />);

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-snapshot'));

      expect(updateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, {
        allModeViewMode: 'snapshot',
      });
    });

    it('hands every server back its own mode when "Per server" is picked', () => {
      allModeViewMode = 'streaming';
      render(<Settings />);

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-per-server'));

      expect(updateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, {
        allModeViewMode: 'per-server',
      });
    });

    // The row's description is what tells the user which state they are in;
    // the trigger's own label comes from Radix, which is stubbed here.
    it('describes the current state, defaulting to per-server', () => {
      const { unmount } = render(<Settings />);
      expect(
        screen.getByText('settings.all_mode_streaming_per_server_desc')
      ).toBeInTheDocument();
      unmount();

      allModeViewMode = 'snapshot';
      render(<Settings />);
      expect(
        screen.getByText('settings.all_mode_streaming_snapshot_desc')
      ).toBeInTheDocument();
    });

    it('is absent in single mode, where Streaming Mode is per-profile', () => {
      vi.mocked(useCurrentProfile).mockReturnValue({
        currentProfile: profileA, isAllMode: false, hasProfile: true,
        settings: baseSettings as never,
      });
      vi.mocked(useProfileScope).mockReturnValue({
        mode: 'single', profile: profileA, profiles: [profileA], settings: baseSettings as never,
      });

      render(<Settings />);

      expect(screen.queryByTestId('all-mode-streaming-select')).not.toBeInTheDocument();
    });
  });

  // The All Servers performance section: the one place the aggregate's
  // guardrails are editable, so what matters here is that its writes land in
  // the ALL bucket and that it stays out of single mode entirely (refs #337).
  describe('All Servers performance', () => {
    it('writes a reset knob back to the ALL bucket', () => {
      vi.mocked(useCurrentProfile).mockImplementation(() => ({
        currentProfile: null, isAllMode: true, hasProfile: false,
        settings: { ...baseSettings, allModeViewMode, allModeMaxStreams: 2 } as never,
      }));
      render(<Settings />);

      fireEvent.click(screen.getByTestId('all-mode-max-streams-reset'));

      expect(updateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, {
        allModeMaxStreams: DEFAULT_SETTINGS.allModeMaxStreams,
      });
    });

    it('is absent in single mode, where none of these guardrails apply', () => {
      vi.mocked(useCurrentProfile).mockReturnValue({
        currentProfile: profileA, isAllMode: false, hasProfile: true,
        settings: baseSettings as never,
      });
      vi.mocked(useProfileScope).mockReturnValue({
        mode: 'single', profile: profileA, profiles: [profileA], settings: baseSettings as never,
      });

      render(<Settings />);

      expect(screen.queryByTestId('all-mode-max-streams-input')).not.toBeInTheDocument();
    });
  });
});
