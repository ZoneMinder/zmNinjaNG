/**
 * The turn's server roster, built once per question (refs #337).
 *
 * `ScopedServer` carries what a tool run against another server needs and the
 * pinned profile's context cannot supply: that server's portal URL, a fresh
 * token for its thumbnails, its streaming port and its timezone. Read at send
 * time rather than subscribed to, because a turn is a snapshot: the answer
 * describes the servers as they were when the question was asked.
 *
 * Tokens come from `getFreshAccessToken`, the auth store's own deduped entry
 * point (auth contract), so this neither caches nor refreshes anything itself.
 * A server whose token cannot be fetched still takes part in the turn: its
 * data reads fine (the session layer authenticates its own requests) and only
 * its card thumbnails come back empty, which is a far better outcome than
 * dropping a server from an answer that claims to cover every server.
 */

import type { Profile } from '../../api/types';
import type { ScopedServer } from './types';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';
import { resolveMinStreamingPort } from '../monitor/multiport';
import { log, LogLevel } from '../logger';

export async function buildScopedServers(profiles: readonly Profile[]): Promise<ScopedServer[]> {
  // One server is not a group: the turn runs exactly as a single-profile turn
  // does, with no `server` argument and no per-server wrapper anywhere.
  if (profiles.length < 2) return [];

  const { getFreshAccessToken } = useAuthStore.getState();
  const { getProfileSettings } = useSettingsStore.getState();

  return Promise.all(
    profiles.map(async (profile) => {
      const settings = getProfileSettings(profile.id);
      let accessToken: string | null = null;
      try {
        accessToken = await getFreshAccessToken(profile.id);
      } catch (e) {
        log.assistant('No access token for a server in scope; its cards lose thumbnails', LogLevel.WARN, {
          profileId: profile.id,
          error: e,
        });
      }
      return {
        profileId: profile.id,
        name: profile.name,
        portalUrl: profile.portalUrl,
        accessToken,
        minStreamingPort: resolveMinStreamingPort(profile.minStreamingPort, settings.forceDisableMultiPort),
        thumbnailFallbackChain: settings.thumbnailFallbackChain,
        timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }),
  );
}
