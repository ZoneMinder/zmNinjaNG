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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { AskPanel } from '../AskPanel';
import { useAssistantStore } from '../../../stores/assistant';
import { ALL_PROFILES_ID } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

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
vi.mock('../../../lib/assistant/providers/openai', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  warmOllamaModel: vi.fn(() => new Promise(() => {})),
}));
// Profile-sensitive, mirroring EventListView/NotificationHistoryItem's own
// tests: a fixed `{ token: null }` regardless of the argument is exactly
// what let AskPanel call this with no profileId at all slip through (it
// resolved to the same no-profile token single mode gets, refs #337 fix
// round 1) - a real regression test has to key the return off the argument.
const useFreshAccessTokenMock = vi.fn((profileId?: string) => ({
  token: profileId ? `${profileId}-token` : null,
  isFresh: !!profileId,
}));
vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: (profileId?: string) => useFreshAccessTokenMock(profileId),
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

const profileA = makeProfile('profile-a', { name: 'Home', apiUrl: 'http://a/api', timezone: 'UTC' });
const profileB = makeProfile('profile-b', { name: 'Work', apiUrl: 'http://b/api', timezone: 'UTC' });

const baseSettings = {
  assistantModelId: 'test-model',
  assistantBackend: 'on-device' as const,
  assistantOllamaModel: '',
  assistantOllamaBaseUrl: '',
  hoverPreview: { assistant: false } as never,
};

describe('AskPanel - All mode profile pinning (refs #337)', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
    useFreshAccessTokenMock.mockClear();
    // Real profile/profileScope/assistant-enabled hooks, seeded to reproduce
    // the All-mode shape the old direct mocks hand-built: two profiles,
    // ALL_PROFILES_ID current, neither with assistantEnabled set (so
    // useAssistantEnabled/AskPanel fall back to the first scope profile).
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: { [profileA.id]: baseSettings, [profileB.id]: baseSettings },
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
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

  // Regression for fix round 1: AskPanel called useFreshAccessToken() with no
  // argument, which resolves to the no-current-profile sentinel in All mode
  // (always null/stale) regardless of which profile is pinned - ToolContext's
  // accessToken (and any authenticated result-card thumbnail built from it)
  // silently 401ed no matter which profile was picked (refs #337).
  it('resolves the fresh access token for the pinned profile, following the picker switch', () => {
    render(<AskPanel />);

    expect(useFreshAccessTokenMock).toHaveBeenLastCalledWith(profileA.id);

    fireEvent.click(screen.getByTestId(`page-profile-picker-option-${profileB.id}`));

    expect(useFreshAccessTokenMock).toHaveBeenLastCalledWith(profileB.id);
  });
});
