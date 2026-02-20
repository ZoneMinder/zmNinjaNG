import { useEffect } from 'react';
import { Platform } from '../lib/platform';
import { useCurrentProfile } from './useCurrentProfile';

const PREFS_KEY = 'zmng_allow_self_signed_certs';

/**
 * Syncs the allowSelfSignedCerts profile setting to Capacitor Preferences
 * (UserDefaults on iOS) so the native SSL proxy delegate can read it.
 *
 * On non-native platforms this is a no-op.
 */
export function useSslSettingsSync(): void {
  const { settings } = useCurrentProfile();
  const { allowSelfSignedCerts } = settings;

  useEffect(() => {
    if (!Platform.isNative) return;

    const sync = async () => {
      try {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.set({
          key: PREFS_KEY,
          value: String(allowSelfSignedCerts),
        });
      } catch {
        // Preferences plugin unavailable — ignore
      }
    };
    sync();
  }, [allowSelfSignedCerts]);
}
