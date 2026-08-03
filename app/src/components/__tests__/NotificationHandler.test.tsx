/**
 * NotificationHandler Component Tests
 *
 * Regression test for the live-event toast contract: the store's
 * websocket listener only calls addEvent (stores/notifications.ts),
 * and relies on this component re-rendering on the profileEvents
 * change to show the toast and play the sound.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { NotificationHandler } from '../NotificationHandler';
import { useNotificationStore } from '../../stores/notifications';
import type { ZMAlarmEvent } from '../../types/notifications';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const PROFILE_ID = 'profile-1';

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: {
      id: 'profile-1',
      name: 'Test Profile',
      portalUrl: 'http://zm.local',
    },
    settings: {
      thumbnailFallbackChain: [],
      forceDisableMultiPort: false,
    },
    hasProfile: true,
  }),
}));

vi.mock('../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: null, isFresh: false }),
}));

vi.mock('../../hooks/useNotificationAutoConnect', () => ({
  useNotificationAutoConnect: () => {},
}));

// Real single-current-profile mode by default; overridden per-test for the
// All-mode fan-out coverage below.
type ScopeLike = {
  mode: string;
  profile: { id: string; name: string } | null;
  profiles: { id: string; name: string }[];
  settings: Record<string, never>;
} | null;
const mockUseProfileScope = vi.fn<() => ScopeLike>(() => null);
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: () => mockUseProfileScope(),
}));

vi.mock('../../components/notifications/ProfileNotificationConnector', () => ({
  ProfileNotificationConnector: ({ profile }: { profile: { id: string } }) => (
    <div data-testid={`connector-${profile.id}`} />
  ),
}));

vi.mock('../../hooks/useNotificationPushSetup', () => ({
  useNotificationPushSetup: () => {},
}));

vi.mock('../../hooks/useNotificationDelivered', () => ({
  useNotificationDelivered: () => {},
}));

function makeEvent(eventId: number): ZMAlarmEvent {
  return {
    MonitorId: 1,
    MonitorName: 'Front Door',
    EventId: eventId,
    Cause: 'Motion',
    Name: `Event-${eventId}`,
  };
}

function renderHandler() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationHandler />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationHandler live-event toasts', () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear();
    useNotificationStore.setState({
      profileEvents: {},
      profileSettings: {},
      currentProfileId: null,
    });
  });

  it('does not toast on mount with no events', () => {
    renderHandler();
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows a toast when addEvent stores a live event for the current profile', () => {
    renderHandler();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_ID, makeEvent(1234));
    });

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('toasts once per distinct event', () => {
    renderHandler();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_ID, makeEvent(1234));
    });
    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_ID, makeEvent(5678));
    });

    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('does not toast again when the same event is re-added', () => {
    renderHandler();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_ID, makeEvent(1234));
    });
    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_ID, makeEvent(1234));
    });

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('does not toast when showToasts is disabled for the profile', () => {
    useNotificationStore.getState().updateProfileSettings(PROFILE_ID, { showToasts: false });
    renderHandler();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_ID, makeEvent(1234));
    });

    expect(toast).not.toHaveBeenCalled();
  });
});

describe('NotificationHandler All-mode fan-out (refs #337)', () => {
  beforeEach(() => {
    mockUseProfileScope.mockReset();
  });

  it('mounts one connector per All-mode scope profile', () => {
    mockUseProfileScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [
        { id: 'profile-a', name: 'Home' },
        { id: 'profile-b', name: 'Work' },
      ],
      settings: {},
    });

    const { getByTestId } = renderHandler();

    expect(getByTestId('connector-profile-a')).toBeInTheDocument();
    expect(getByTestId('connector-profile-b')).toBeInTheDocument();
  });

  it('mounts no connectors in single mode', () => {
    mockUseProfileScope.mockReturnValue({
      mode: 'single',
      profile: { id: 'profile-1', name: 'Test Profile' },
      profiles: [{ id: 'profile-1', name: 'Test Profile' }],
      settings: {},
    });

    const { queryByTestId } = renderHandler();

    expect(queryByTestId('connector-profile-1')).not.toBeInTheDocument();
  });
});
