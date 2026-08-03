/**
 * Hook to resolve per-monitor URLs for multi-server setups.
 *
 * Returns the correct recordingUrl, portalPath, and apiBaseUrl for a
 * given monitor's ServerId. Falls back to profile defaults for
 * single-server setups or when ServerId is null.
 *
 * Reacts to server map changes (populated during bootstrap) via
 * useSyncExternalStore so streams re-render with correct URLs once
 * the server list is fetched.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useProfileById } from './useCurrentProfile';
import {
  resolveMonitorUrls,
  getServerMap,
  subscribeServerMap,
  type ResolvedMonitorUrls,
} from '../lib/zm/server-resolver';
import type { ProfileId } from '../api/types';

/**
 * @param profileId - Profile whose cgi/portal/api URLs to resolve against;
 * defaults to the current profile.
 */
export function useServerUrls(
  serverId: string | null | undefined,
  profileId?: ProfileId | null,
): ResolvedMonitorUrls {
  const { profile } = useProfileById(profileId);

  // Re-render when the server map changes (e.g., after bootstrap populates
  // it). Snapshotting the map itself (not a version counter) keeps it a
  // real useMemo dependency instead of an unused one. Reads THIS profile's
  // own map (refs #337) - not whichever profile bootstrapped most recently.
  const serverMap = useSyncExternalStore(subscribeServerMap, () => getServerMap(profile?.id));

  return useMemo(() => {
    if (!profile) {
      return {
        recordingUrl: '',
        portalPath: '',
        apiBaseUrl: '',
        isMultiServer: false,
      };
    }

    return resolveMonitorUrls(serverId, serverMap, {
      portalUrl: profile.portalUrl,
      cgiUrl: profile.cgiUrl,
      apiUrl: profile.apiUrl,
    });
  }, [serverId, profile, serverMap]);
}
