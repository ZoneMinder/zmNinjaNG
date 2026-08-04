/**
 * Regression test (refs #337): AskPanel's system-prompt version probe must
 * resolve the PINNED profile's session (getSession(profileId)), not
 * getCurrentSession() - which reads the store's globally-selected profile.
 * Under the All-mode ALL_PROFILES_ID sentinel there is no session for the
 * sentinel itself, so getCurrentSession() throws; the throw was swallowed by
 * the surrounding try/catch, silently dropping the ZM version from the
 * system prompt (and logging a WARN) on every single turn.
 *
 * Drives the real `handleSend` -> `getVersion` call via the assistant's
 * test-mode seam (`isAssistantTestMode()` + `sharedMockProvider`), the same
 * mechanism e2e steps use (tests/steps/assistant.steps.ts) - a scripted,
 * single-turn, no-tool-call reply completes the turn deterministically.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AskPanel } from '../AskPanel';
import { useAssistantStore } from '../../../stores/assistant';
import { useCurrentProfile, useProfileById } from '../../../hooks/useCurrentProfile';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { getSession } from '../../../services/sessions';
import { getVersion } from '../../../api/auth';
import { STORAGE_KEYS } from '../../../lib/zmninja-ng-constants';
import { asProfileId, ALL_PROFILES_ID } from '../../../api/types';
import type { Profile } from '../../../api/types';
import type { AssistantTurn } from '../../../lib/assistant/types';

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
vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: null, isFresh: false }),
}));
vi.mock('../useAssistantHost', () => ({
  useAssistantHost: () => ({ host: { navigate: vi.fn(), onActivity: vi.fn() } }),
}));
// getObjectLabels transitively pulls in api/events -> the real API client
// chain; stubbed here (like lib/assistant/tools is stubbed in the sibling
// pinning test) since this test is only about the version probe.
vi.mock('../../../lib/assistant/object-labels', () => ({
  getObjectLabels: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../api/auth', () => ({ getVersion: vi.fn() }));
// getCurrentSession throws for the ALL_PROFILES_ID sentinel in real code
// (services/sessions.ts never builds a session for it) - reproduced here so
// the OLD buggy call site (getCurrentSession()) fails exactly as it does in
// production, while getSession(profileId) (the fix) succeeds.
vi.mock('../../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(() => {
    throw new Error('No session for the ALL_PROFILES_ID sentinel');
  }),
  registerSessionsGate: vi.fn(),
}));
vi.mock('../../../hooks/useMonitors', () => ({ useMonitors: () => ({ monitors: [] }) }));
vi.mock('../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="assistant-live-player-stub" />,
}));
vi.mock('../../events/EventThumbnail', () => ({
  EventThumbnail: () => <div data-testid="assistant-card-thumbnail-stub" />,
}));

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

function clientFor(id: string) {
  return { marker: id };
}

describe('AskPanel - All mode version probe uses the pinned session (refs #337)', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');
    window.__assistantMockScript = [{ text: 'ok', toolCalls: [] } as AssistantTurn];
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null, settings: baseSettings as never, hasProfile: false, isAllMode: true,
    });
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: baseSettings as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', aggregateId: ALL_PROFILES_ID, aggregateName: null, profile: null, profiles: [profileA, profileB], settings: baseSettings as never,
    });
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id, client: clientFor(id) as never, timezone: 'UTC',
    }));
    vi.mocked(getVersion).mockResolvedValue({ version: '1.36.0' } as never);
  });

  afterEach(() => {
    delete window.__assistantMockScript;
    localStorage.removeItem(STORAGE_KEYS.assistantTestMode);
  });

  it('resolves getVersion via getSession(pinnedProfileId), not the throwing getCurrentSession sentinel', async () => {
    render(<AskPanel />);

    fireEvent.change(screen.getByTestId('assistant-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('assistant-send'));

    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(1));
    expect(getSession).toHaveBeenCalledWith(profileA.id);
    expect(getVersion).toHaveBeenCalledWith(clientFor(profileA.id));
  });
});
