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
 * Pure: union the TLS trust settings across all profiles into the shape the
 * native plugin needs. For each profile with self-signed trust on and a
 * stored fingerprint, emit one entry per distinct hostname among its
 * portalUrl/apiUrl/cgiUrl/go2rtcUrl (today's single fingerprint applies to
 * all of a profile's hosts). `enabled` is true when ANY profile trusts,
 * independent of whether a fingerprint has been pinned yet (TOFU: accept any
 * certificate until one is stored). Two profiles claiming the same host is a
 * misconfiguration; last write wins and it's logged.
 */
export function collectTrustEntries(
  profiles: Profile[],
  getSettings: (id: ProfileId) => ProfileSettings
): { enabled: boolean; entries: Array<{ host: string; fingerprint: string }> } {
  let enabled = false;
  const byHost = new Map<string, string>();

  for (const profile of profiles) {
    const settings = getSettings(profile.id);
    if (!settings.allowSelfSignedCerts) continue;
    enabled = true;
    if (!settings.trustedCertFingerprint) continue;

    const hosts = new Set<string>();
    for (const url of [profile.portalUrl, profile.apiUrl, profile.cgiUrl, profile.go2rtcUrl]) {
      if (!url) continue;
      try {
        hosts.add(new URL(url).hostname);
      } catch {
        // skip unparseable URL
      }
    }
    for (const host of hosts) {
      if (byHost.has(host)) {
        log.sslTrust(`TLS trust host "${host}" claimed by more than one profile; using the most recent`, LogLevel.WARN);
      }
      byHost.set(host, settings.trustedCertFingerprint);
    }
  }

  const entries = Array.from(byHost, ([host, fingerprint]) => ({ host, fingerprint }));
  return { enabled, entries };
}

/**
 * Apply the union of all profiles' TLS trust settings to the platform.
 * - Native (iOS/Android): enables/disables via the SSLTrust Capacitor plugin,
 *   and pushes the host->fingerprint map for TOFU validation.
 * - Electron: forwards the enabled boolean to the main-process net stack.
 * - Web: no-op.
 */
export async function applyTrustedCertificates(): Promise<void> {
  const { useProfileStore } = await import('../../stores/profile');
  const { useSettingsStore } = await import('../../stores/settings');
  const { profiles } = useProfileStore.getState();
  const { getProfileSettings } = useSettingsStore.getState();
  const { enabled, entries } = collectTrustEntries(profiles, getProfileSettings);

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
