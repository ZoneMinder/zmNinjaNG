/**
 * AskPanel All-mode assistant pinning tests (refs #337).
 *
 * All mode has no single "current profile" (useCurrentProfile returns null
 * there), so the assistant pins itself to one profile from useProfileScope's
 * list instead - defaulting to the first, switchable via the shared
 * ProfilePicker (see Task 4's server-scoped page pickers). This only
 * exercises that pinning surface (banner, picker, thread keyed by the pinned
 * id); the send/tool-loop wiring already has its own coverage in
 * AskPanel.test.tsx and lib/assistant's own tests (see that file's header).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AskPanel } from '../AskPanel';
import { useAssistantStore } from '../../../stores/assistant';
import { useCurrentProfile, useProfileById } from '../../../hooks/useCurrentProfile';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { asProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../../lib/platform', () => ({
  Platform: { isIOS: false, isNative: false, isAndroid: true },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
}));
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
  useProfileById: vi.fn(),
}));
vi.mock('../../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../../lib/security/secureStorage', () => ({ getSecureValue: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../lib/assistant/providers/openai', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  warmOllamaModel: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: null, isFresh: false }),
}));
vi.mock('../useAssistantHost', () => ({
  useAssistantHost: () => ({ host: { navigate: vi.fn(), onActivity: vi.fn() } }),
}));
vi.mock('../../../lib/assistant/tools', () => ({
  getToolByName: (name: string) => ({ name, description: `${name} description` }),
}));
vi.mock('../../../api/auth', () => ({ getVersion: vi.fn() }));
vi.mock('../../../hooks/useMonitors', () => ({ useMonitors: () => ({ monitors: [] }) }));
vi.mock('../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="assistant-live-player-stub" />,
}));
vi.mock('../../events/EventThumbnail', () => ({
  EventThumbnail: () => <div data-testid="assistant-card-thumbnail-stub" />,
}));

// Same stub-Select pattern as pages/__tests__/Logs.allmode.test.tsx (Task 4):
// ProfilePicker renders shadcn's Select, which jsdom can't drive via real
// pointer events without Radix's full portal/positioning machinery.
const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../ui/select', () => ({
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

const profileA = { id: asProfileId('profile-a'), name: 'Home', apiUrl: 'http://a/api', timezone: 'UTC' } as Profile;
const profileB = { id: asProfileId('profile-b'), name: 'Work', apiUrl: 'http://b/api', timezone: 'UTC' } as Profile;

const baseSettings = {
  assistantModelId: 'test-model',
  assistantBackend: 'on-device',
  assistantOllamaModel: '',
  assistantOllamaBaseUrl: '',
  hoverPreview: { assistant: false },
};

describe('AskPanel - All mode profile pinning (refs #337)', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null, settings: baseSettings as never, hasProfile: false, isAllMode: true,
    });
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: baseSettings as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', profile: null, profiles: [profileA, profileB], settings: baseSettings as never,
    });
  });

  it('pins to the first scope profile by default and names it in a persistent banner', () => {
    render(<AskPanel />);

    expect(screen.getByTestId('assistant-pinned-banner')).toHaveTextContent('Home');
    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
  });

  it('switches the pinned profile (and the thread it reads) when a different one is picked', () => {
    useAssistantStore.getState().append(profileB.id, { role: 'user', text: 'hello from B' });

    render(<AskPanel />);

    // Default pin is profileA - profileB's thread is not shown yet.
    expect(screen.queryByText('hello from B')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`page-profile-picker-option-${profileB.id}`));

    expect(screen.getByTestId('assistant-pinned-banner')).toHaveTextContent('Work');
    expect(screen.getByText('hello from B')).toBeInTheDocument();
  });
});
