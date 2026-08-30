/**
 * NotificationHandler Component Tests
 *
 * Regression test for the live-event toast contract: the store's
 * websocket listener only calls addEvent (stores/notifications.ts),
 * and relies on this component re-rendering on the profileEvents
 * change to show the toast and play the sound.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { NotificationHandler } from '../NotificationHandler';
import { useNotificationStore } from '../../stores/notifications';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { ALL_PROFILES_ID } from '../../api/types';
import { useSettingsStore, mergeProfileSettings, type ProfileSettings } from '../../stores/settings';

// seedProfiles only seeds settings buckets keyed by real profile ids; the
// All-mode aggregate reads its own bucket under ALL_PROFILES_ID, so that one
// is set directly the same way profile-fixture seeds the real ones.
function seedAllModeSettings(overrides: Partial<ProfileSettings>) {
  useSettingsStore.setState((state) => ({
    profileSettings: { ...state.profileSettings, [ALL_PROFILES_ID]: mergeProfileSettings(overrides) },
  }));
}
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

vi.mock('../../hooks/useNotificationAutoConnect', () => ({
  useNotificationAutoConnect: () => {},
}));

vi.mock('../../components/notifications/ProfileNotificationConnector', () => ({
  ProfileNotificationConnector: ({ profile }: { profile: { id: string } }) => (
    <div data-testid={`connector-${profile.id}`} />
  ),
}));

const pushSetupCalls = vi.hoisted(() => [] as Array<{ enabled?: boolean; notificationMode?: string } | null>);

vi.mock('../../hooks/useNotificationPushSetup', () => ({
  useNotificationPushSetup: ({ settings }: { settings: { enabled?: boolean; notificationMode?: string } | null }) => {
    pushSetupCalls.push(settings);
  },
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
    seedProfiles([makeProfile(PROFILE_ID, { name: 'Test Profile', portalUrl: 'http://zm.local' })]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
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
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('mounts one connector per All-mode scope profile', () => {
    seedProfiles(['profile-a', 'profile-b'], { current: ALL_PROFILES_ID });

    const { getByTestId } = renderHandler();

    expect(getByTestId('connector-profile-a')).toBeInTheDocument();
    expect(getByTestId('connector-profile-b')).toBeInTheDocument();
  });

  it('mounts no connectors in single mode', () => {
    seedProfiles([makeProfile('profile-1', { name: 'Test Profile' })]);

    const { queryByTestId } = renderHandler();

    expect(queryByTestId('connector-profile-1')).not.toBeInTheDocument();
  });

  // refs #337: the live/muted/off upgrade. 'off' must not mount any
  // connector at all - zero websockets/pollers, nothing accumulates from
  // live paths (distinct from 'muted', which still connects and only
  // suppresses toast/sound display at the useNotificationAllModeToasts seam).
  it('mounts no connectors when allModeNotifications is off', () => {
    seedProfiles(['profile-a', 'profile-b'], { current: ALL_PROFILES_ID });
    seedAllModeSettings({ allModeNotifications: 'off' });

    const { queryByTestId } = renderHandler();

    expect(queryByTestId('connector-profile-a')).not.toBeInTheDocument();
    expect(queryByTestId('connector-profile-b')).not.toBeInTheDocument();
  });

  it('still mounts connectors when allModeNotifications is muted', () => {
    seedProfiles(['profile-a'], { current: ALL_PROFILES_ID });
    seedAllModeSettings({ allModeNotifications: 'muted' });

    const { getByTestId } = renderHandler();

    expect(getByTestId('connector-profile-a')).toBeInTheDocument();
  });
});

// Direct mode never opens a websocket, so nothing in `connections` changes when
// the user enables it. Unless this component subscribes to profileSettings, it
// never re-renders and useNotificationPushSetup keeps its stale `enabled:false`
// settings -- FCM registration never runs and the badge stays "not registered"
// until an unrelated ES connect happens to re-render it.
describe('NotificationHandler settings subscription', () => {
  beforeEach(() => {
    pushSetupCalls.length = 0;
    useNotificationStore.setState({
      profileEvents: {},
      profileSettings: {},
      currentProfileId: null,
    });
    seedProfiles([makeProfile(PROFILE_ID, { name: 'Test Profile', portalUrl: 'http://zm.local' })]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('passes updated settings to push setup when direct mode is enabled', () => {
    useNotificationStore.getState().updateProfileSettings(PROFILE_ID, {
      enabled: false,
      notificationMode: 'direct',
    });
    renderHandler();
    expect(pushSetupCalls.at(-1)?.enabled).toBe(false);

    act(() => {
      useNotificationStore.getState().updateProfileSettings(PROFILE_ID, { enabled: true });
    });

    expect(pushSetupCalls.at(-1)?.enabled).toBe(true);
    expect(pushSetupCalls.at(-1)?.notificationMode).toBe('direct');
  });
});
