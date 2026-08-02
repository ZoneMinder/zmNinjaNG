import { Platform } from '../platform';
import { log, LogLevel } from '../logger';
import type { CertInfo } from '../../plugins/ssl-trust/definitions';
import type { Profile, ProfileId } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

declare global {
  interface Window {
    electronSsl?: { setTrustSelfSigned(enabled: boolean): Promise<boolean> };
  }
}

/**
 * An in-flight profile (being created or edited, not yet committed to the
 * profile store) that should contribute to the trust union alongside saved
 * profiles, e.g. during test-connection, before `addProfile`/`updateProfile`
 * has run. `fingerprint: null` with `enabled: true` means TOFU accept-any for
 * `urls`' hosts (no pin yet); it wins host collisions against saved profiles
 * since it reflects the freshest user intent.
 */
export interface TrustCandidate {
  urls: Array<string | undefined>;
  fingerprint: string | null;
  enabled: boolean;
}

function hostnamesOf(urls: Array<string | undefined>): Set<string> {
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // skip unparseable URL
    }
  }
  return hosts;
}

/**
 * Pure: union the TLS trust settings across all profiles (plus an optional
 * in-flight candidate) into the shape the native plugin needs. For each
 * profile with self-signed trust on and a stored fingerprint, emit one entry
 * per distinct hostname among its portalUrl/apiUrl/cgiUrl/go2rtcUrl (today's
 * single fingerprint applies to all of a profile's hosts). `enabled` is true
 * when ANY profile (or the candidate) trusts, independent of whether a
 * fingerprint has been pinned yet (TOFU: accept any certificate until one is
 * stored). Two entries claiming the same host is a misconfiguration; last
 * write wins and it's logged. The candidate is applied last, so it wins
 * against a saved profile.
 */
export function collectTrustEntries(
  profiles: Profile[],
  getSettings: (id: ProfileId) => ProfileSettings,
  candidate?: TrustCandidate
): { enabled: boolean; entries: Array<{ host: string; fingerprint: string }> } {
  let enabled = false;
  const byHost = new Map<string, string>();

  const addHosts = (urls: Array<string | undefined>, fingerprint: string) => {
    for (const host of hostnamesOf(urls)) {
      if (byHost.has(host)) {
        log.sslTrust(`TLS trust host "${host}" claimed by more than one profile; using the most recent`, LogLevel.WARN);
      }
      byHost.set(host, fingerprint);
    }
  };

  for (const profile of profiles) {
    const settings = getSettings(profile.id);
    if (!settings.allowSelfSignedCerts) continue;
    enabled = true;
    if (!settings.trustedCertFingerprint) continue;
    addHosts([profile.portalUrl, profile.apiUrl, profile.cgiUrl, profile.go2rtcUrl], settings.trustedCertFingerprint);
  }

  if (candidate) {
    if (candidate.enabled) enabled = true;
    if (candidate.fingerprint) addHosts(candidate.urls, candidate.fingerprint);
  }

  const entries = Array.from(byHost, ([host, fingerprint]) => ({ host, fingerprint }));
  return { enabled, entries };
}

/**
 * Apply the union of all profiles' TLS trust settings to the platform.
 * Pass `candidate` to fold in an in-flight profile that isn't committed to
 * the store yet (e.g. a test-connection in progress) so it's trusted too.
 * - Native (iOS/Android): enables/disables via the SSLTrust Capacitor plugin,
 *   and pushes the host->fingerprint map for TOFU validation.
 * - Electron: forwards the enabled boolean to the main-process net stack.
 * - Web: no-op.
 */
export async function applyTrustedCertificates(candidate?: TrustCandidate): Promise<void> {
  const { useProfileStore } = await import('../../stores/profile');
  const { useSettingsStore } = await import('../../stores/settings');
  const { profiles } = useProfileStore.getState();
  const { getProfileSettings } = useSettingsStore.getState();
  const { enabled, entries } = collectTrustEntries(profiles, getProfileSettings, candidate);

  if (Platform.isNative) {
    try {
      const { SSLTrust } = await import('../../plugins/ssl-trust');
      if (enabled) {
        await SSLTrust.enable();
        await SSLTrust.setTrustedFingerprints({ entries });
        log.sslTrust('Native: set trust-self-signed-certs to true', LogLevel.INFO, {
          entryCount: entries.length,
        });
      } else {
        await SSLTrust.disable();
        log.sslTrust('Native: set trust-self-signed-certs to false', LogLevel.DEBUG);
      }
    } catch (error) {
      log.sslTrust('Failed to apply SSL trust setting', LogLevel.ERROR, { error });
    }
  } else if (Platform.isElectron) {
    try {
      if (typeof window !== 'undefined' && window.electronSsl) {
        await window.electronSsl.setTrustSelfSigned(enabled);
        log.sslTrust(
          `Electron: set trust-self-signed-certs to ${enabled}`,
          enabled ? LogLevel.INFO : LogLevel.DEBUG
        );
      }
    } catch (error) {
      log.sslTrust('Failed to apply Electron SSL trust setting', LogLevel.ERROR, { error });
    }
  } else {
    log.sslTrust('SSL trust override not applicable on web', LogLevel.DEBUG);
  }
}

/**
 * Fetch the server's TLS certificate fingerprint.
 * Only works on native platforms (iOS/Android).
 * Returns null on web and Electron.
 */
export async function getServerCertFingerprint(url: string): Promise<CertInfo | null> {
  if (!Platform.isNative) return null;
  try {
    const { SSLTrust } = await import('../../plugins/ssl-trust');
    const certInfo = await SSLTrust.getServerCertFingerprint({ url });
    log.sslTrust('Fetched server certificate fingerprint', LogLevel.INFO, {
      fingerprint: certInfo.fingerprint,
      subject: certInfo.subject,
    });
    return certInfo;
  } catch (error) {
    log.sslTrust('Failed to fetch server certificate fingerprint', LogLevel.ERROR, { error });
    return null;
  }
}

export type { CertInfo };
