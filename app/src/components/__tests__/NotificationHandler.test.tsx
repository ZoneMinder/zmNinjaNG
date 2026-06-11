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
  return render(
    <MemoryRouter>
      <NotificationHandler />
    </MemoryRouter>,
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
