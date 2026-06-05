/**
 * Multi-port streaming resolution.
 *
 * ZoneMinder's ZM_MIN_STREAMING_PORT config enables per-monitor stream ports
 * (port = minStreamingPort + monitorId). The fetched base port is stored on the
 * profile as `minStreamingPort`. A per-profile advanced setting,
 * `forceDisableMultiPort`, lets the user opt out for servers whose per-monitor
 * ports are not reachable (firewall, reverse proxy, partial config).
 *
 * These helpers are the single sanctioned way to read the effective base port.
 * When the override is on they return undefined, so `applyMultiPort` in
 * url-builder.ts becomes a no-op and URLs use the portal's default port.
 */

import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';

/**
 * Resolve the multi-port base, honoring the per-profile force-disable override.
 *
 * @param rawPort The profile's server-derived `minStreamingPort`.
 * @param forceDisableMultiPort The profile setting; when true, returns undefined.
 * @returns The base port to apply, or undefined when multi-port is off.
 */
export function resolveMinStreamingPort(
  rawPort: number | null | undefined,
  forceDisableMultiPort: boolean | undefined,
): number | undefined {
  if (forceDisableMultiPort) return undefined;
  return rawPort ?? undefined;
}

/**
 * Non-React variant that reads the profile and its settings from the stores.
 * Use in services and other code outside the React tree.
 *
 * @param profileId The profile to resolve for.
 * @returns The effective base port, or undefined when off/unavailable.
 */
export function getEffectiveMinStreamingPort(
  profileId: string | null | undefined,
): number | undefined {
  if (!profileId) return undefined;
  const profile = useProfileStore.getState().profiles.find((p) => p.id === profileId);
  const settings = useSettingsStore.getState().getProfileSettings(profileId);
  return resolveMinStreamingPort(profile?.minStreamingPort, settings.forceDisableMultiPort);
}
