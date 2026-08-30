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

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { AskPanel } from '../AskPanel';
import { useAssistantStore } from '../../../stores/assistant';
import { getSession } from '../../../services/sessions';
import { getVersion } from '../../../api/auth';
import { STORAGE_KEYS } from '../../../lib/zmninja-ng-constants';
import { ALL_PROFILES_ID } from '../../../api/types';
import type { AssistantTurn } from '../../../lib/assistant/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

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

const profileA = makeProfile('profile-a', { name: 'Home', apiUrl: 'http://a/api', timezone: 'UTC' });
const profileB = makeProfile('profile-b', { name: 'Work', apiUrl: 'http://b/api', timezone: 'UTC' });

const baseSettings = {
  assistantModelId: 'test-model',
  assistantBackend: 'on-device' as const,
  assistantOllamaModel: '',
  assistantOllamaBaseUrl: '',
  hoverPreview: { assistant: false } as never,
};

describe('AskPanel - All mode version probe uses the pinned session (refs #337)', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');
    window.__assistantMockScript = [{ text: 'ok', toolCalls: [] } as AssistantTurn];
    // Real profile/profileScope/session-registry stack: with ALL_PROFILES_ID
    // current, the real getCurrentSession() throws (services/sessions.ts
    // never builds a session for the sentinel) exactly like production, so
    // the OLD buggy call site fails the same way here; getSession(profileId)
    // (the fix) succeeds against the pinned profile's real session.
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: { [profileA.id]: baseSettings, [profileB.id]: baseSettings },
    });
    installApiClient(profileA.id, fakeApiClient());
    installApiClient(profileB.id, fakeApiClient());
    vi.mocked(getVersion).mockResolvedValue({ version: '1.36.0' } as never);
  });

  afterEach(() => {
    delete window.__assistantMockScript;
    localStorage.removeItem(STORAGE_KEYS.assistantTestMode);
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('resolves getVersion via getSession(pinnedProfileId), not the throwing getCurrentSession sentinel', async () => {
    render(<AskPanel />);

    fireEvent.change(screen.getByTestId('assistant-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('assistant-send'));

    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(1));
    expect(getVersion).toHaveBeenCalledWith(getSession(profileA.id).client);
  });
});
