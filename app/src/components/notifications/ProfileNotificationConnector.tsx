/**
 * Profile Notification Connector
 *
 * Mounted once per enabled profile while All mode is active (refs #337), so
 * every profile gets its own live notification connection (ES websocket, or
 * direct-mode poller on desktop/web) instead of only the app's single
 * "current" profile. Reuses useNotificationAutoConnect unchanged: each
 * instance is a fixed one-profile client for its whole lifetime, so React's
 * own mount/unmount (driven by the caller keying on profile.id) is the fan
 * out and teardown mechanism - no scope-fanning loop inside the hook itself.
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNotificationStore } from '../../stores/notifications';
import { useProfileStore } from '../../stores/profile';
import { useNotificationAutoConnect } from '../../hooks/useNotificationAutoConnect';
import { getEventPoller } from '../../services/eventPoller';
import type { Profile } from '../../api/types';

export interface ProfileNotificationConnectorProps {
  profile: Profile;
}

export function ProfileNotificationConnector({ profile }: ProfileNotificationConnectorProps) {
  const getDecryptedPassword = useProfileStore((state) => state.getDecryptedPassword);

  const { getProfileSettings, connectionState, connect } = useNotificationStore(
    useShallow((state) => ({
      getProfileSettings: state.getProfileSettings,
      connectionState: state.connections[profile.id] ?? 'disconnected',
      connect: state.connect,
    }))
  );
  const settings = getProfileSettings(profile.id);
  const isConnected = connectionState === 'connected';

  useNotificationAutoConnect({
    currentProfile: profile,
    settings,
    isConnected,
    connectionState,
    // This connector only ever manages its own profile, so it is always
    // "the current one" from the hook's point of view - the hook's
    // profile-switch effect only fires for a genuine switch within one
    // instance, which never happens here.
    currentProfileId: profile.id,
    connect,
    disconnect: () => useNotificationStore.getState().disconnect(profile.id),
    reconnect: (force) => useNotificationStore.getState().reconnect(profile.id, force),
    getDecryptedPassword,
  });

  // Teardown when this profile leaves All-mode scope (switch/disable/delete,
  // or exiting All mode): the hook's own cleanup stops the poller on a
  // notificationMode/enabled change, but nothing else disconnects the ES
  // websocket for a component that simply unmounts instead of switching
  // `currentProfile` within one persistent hook instance (refs #337).
  useEffect(() => {
    return () => {
      useNotificationStore.getState().disconnect(profile.id);
      const poller = getEventPoller(profile.id);
      if (poller.isRunning()) {
        poller.stop();
      }
    };
  }, [profile.id]);

  return null;
}
