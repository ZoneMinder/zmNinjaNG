/**
 * ProfileNotificationConnector Tests
 *
 * Verifies the All-mode fan-out mechanism (refs #337): mounting the
 * connector wires useNotificationAutoConnect to this component's own
 * profile (own credentials, own connections[] slice), and unmounting it
 * tears down that profile's ES connection and poller without touching any
 * other profile's.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ProfileNotificationConnector } from '../ProfileNotificationConnector';
import { useNotificationStore } from '../../../stores/notifications';
import { asProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';

const mockAutoConnect = vi.fn();
vi.mock('../../../hooks/useNotificationAutoConnect', () => ({
  useNotificationAutoConnect: (params: unknown) => mockAutoConnect(params),
}));

const mockStopEventPoller = vi.fn();
vi.mock('../../../services/eventPoller', () => ({
  stopEventPoller: (profileId: string) => mockStopEventPoller(profileId),
}));

function makeProfile(id: string, name: string): Profile {
  return {
    id: asProfileId(id),
    name,
    username: 'admin',
    password: 'secret',
    portalUrl: `http://${id}.local`,
    apiUrl: `http://${id}.local/api`,
    cgiUrl: `http://${id}.local/cgi-bin`,
    isDefault: false,
    createdAt: Date.now(),
  };
}

const profileA = makeProfile('profile-a', 'Home');
const profileB = makeProfile('profile-b', 'Work');

describe('ProfileNotificationConnector (refs #337)', () => {
  beforeEach(() => {
    mockAutoConnect.mockClear();
    mockStopEventPoller.mockClear();
    useNotificationStore.setState({
      profileSettings: {},
      connections: {},
      currentProfileId: null,
    });
  });

  it('wires useNotificationAutoConnect to its own profile', () => {
    render(<ProfileNotificationConnector profile={profileA} />);

    expect(mockAutoConnect).toHaveBeenCalledTimes(1);
    const params = mockAutoConnect.mock.calls[0][0];
    expect(params.currentProfile).toBe(profileA);
    expect(params.currentProfileId).toBe(profileA.id);
  });

  // Regression (refs #337 I2): the connector selected only the stable
  // getProfileSettings action, not the raw profileSettings slice, so
  // enabling notifications for a profile already mounted in All mode never
  // re-rendered the connector - it just sat there never connecting.
  it('re-renders with fresh settings when this profile\'s notification settings change', () => {
    render(<ProfileNotificationConnector profile={profileA} />);

    expect(mockAutoConnect).toHaveBeenCalledTimes(1);
    expect(mockAutoConnect.mock.calls[0][0].settings.enabled).toBe(false);

    act(() => {
      useNotificationStore.getState().updateProfileSettings(profileA.id, { enabled: true });
    });

    const lastCall = mockAutoConnect.mock.calls[mockAutoConnect.mock.calls.length - 1][0];
    expect(mockAutoConnect.mock.calls.length).toBeGreaterThan(1);
    expect(lastCall.settings.enabled).toBe(true);
  });

  it('two connectors each see their own profile\'s connection state', () => {
    useNotificationStore.setState({
      connections: { [profileA.id]: 'connected', [profileB.id]: 'connecting' },
    });

    render(
      <>
        <ProfileNotificationConnector profile={profileA} />
        <ProfileNotificationConnector profile={profileB} />
      </>
    );

    const paramsA = mockAutoConnect.mock.calls[0][0];
    const paramsB = mockAutoConnect.mock.calls[1][0];
    expect(paramsA.connectionState).toBe('connected');
    expect(paramsA.isConnected).toBe(true);
    expect(paramsB.connectionState).toBe('connecting');
    expect(paramsB.isConnected).toBe(false);
  });

  it('disconnect callback targets only this connector\'s profile', () => {
    const disconnectSpy = vi.spyOn(useNotificationStore.getState(), 'disconnect');
    render(<ProfileNotificationConnector profile={profileB} />);

    const params = mockAutoConnect.mock.calls[0][0];
    params.disconnect();

    expect(disconnectSpy).toHaveBeenCalledWith(profileB.id);
  });

  it('reconnect callback targets only this connector\'s profile', () => {
    const reconnectSpy = vi.spyOn(useNotificationStore.getState(), 'reconnect').mockResolvedValue(undefined);
    render(<ProfileNotificationConnector profile={profileB} />);

    const params = mockAutoConnect.mock.calls[0][0];
    params.reconnect(true);

    expect(reconnectSpy).toHaveBeenCalledWith(profileB.id, true);
  });

  it('a profile leaving scope tears down only its own connection and poller', () => {
    const disconnectSpy = vi.spyOn(useNotificationStore.getState(), 'disconnect');

    const { rerender } = render(
      <>
        <ProfileNotificationConnector profile={profileA} />
        <ProfileNotificationConnector profile={profileB} />
      </>
    );

    // profileB leaves scope (disabled/deleted/switched away); A stays mounted.
    rerender(<ProfileNotificationConnector profile={profileA} />);

    expect(disconnectSpy).toHaveBeenCalledWith(profileB.id);
    expect(disconnectSpy).not.toHaveBeenCalledWith(profileA.id);
    expect(mockStopEventPoller).toHaveBeenCalledWith(profileB.id);
    expect(mockStopEventPoller).not.toHaveBeenCalledWith(profileA.id);
  });

  it('unmounting all connectors disconnects every profile', () => {
    const disconnectSpy = vi.spyOn(useNotificationStore.getState(), 'disconnect');

    const { unmount } = render(
      <>
        <ProfileNotificationConnector profile={profileA} />
        <ProfileNotificationConnector profile={profileB} />
      </>
    );

    unmount();

    expect(disconnectSpy).toHaveBeenCalledWith(profileA.id);
    expect(disconnectSpy).toHaveBeenCalledWith(profileB.id);
  });
});
