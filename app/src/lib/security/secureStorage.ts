/**
 * Secure Storage Utility
 * 
 * Provides a unified interface for securely storing sensitive data (like passwords)
 * across different platforms (iOS, Android, Web).
 * 
 * Implementation Details:
 * - Mobile (iOS/Android): Uses @aparajita/capacitor-secure-storage to access
 *   native hardware-backed storage (Keychain/Keystore).
 * - Web/Desktop: Uses AES-GCM encryption (via Web Crypto API) and stores
 *   the encrypted blob in localStorage.
 * 
 * Confidentiality:
 * - iOS: Keychain (hardware-encrypted, accessible only by the app).
 * - Android: Android Keystore.
 * - Web/Desktop: AES-GCM, but the key material lives in localStorage next to
 *   the ciphertext (see lib/security/crypto.ts), so this is obfuscation, not real at-rest
 *   confidentiality against a local reader. Only the native paths protect data
 *   from a reader of the store.
 */

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Platform } from '../platform';
import {
  encrypt,
  decrypt,
  decryptLegacy,
  isCryptoAvailable,
  isProbablyEncryptedPayload,
} from './crypto';
import { log, LogLevel } from '../logger';

const STORAGE_PREFIX = 'zmng_secure_';

// Marks a localStorage blob encrypted by the Electron main-process safeStorage
// (OS keychain), distinguishing it from a web-crypto blob so getSecureValue
// can pick the right path and migrate older web-crypto values.
const ELECTRON_SAFE_PREFIX = 'esafe:';

declare global {
  interface Window {
    electronSecure?: {
      isAvailable(): Promise<boolean>;
      encrypt(plaintext: string): Promise<string | null>;
      decrypt(base64: string): Promise<string | null>;
    };
  }
}

/**
 * Check if we're running on a native platform (iOS/Android).
 */
function isNativePlatform(): boolean {
  return Platform.isNative;
}

/**
 * True when the Electron OS-backed secret encryption bridge is present and the
 * OS reports encryption available. Unlike the web-crypto path, the key is held
 * by the OS keychain, not stored next to the ciphertext.
 */
async function isElectronSecureAvailable(): Promise<boolean> {
  if (!Platform.isElectron || typeof window === 'undefined' || !window.electronSecure) {
    return false;
  }
  try {
    return await window.electronSecure.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Store a value securely.
 * 
 * @param key - The identifier for the value
 * @param value - The string value to store
 */
export async function setSecureValue(key: string, value: string): Promise<void> {
  const fullKey = `${STORAGE_PREFIX}${key}`;

  if (isNativePlatform()) {
    // Use SecureStorage plugin (iOS Keychain / Android Keystore)
    log.secureStorage('Storing in native secure storage (Keychain/Keystore)', LogLevel.DEBUG, {
      key,
      platform: Capacitor.getPlatform(),
    });
    await SecureStorage.set(fullKey, value);
  } else {
    // Electron: prefer OS-backed safeStorage (key held by the OS keychain).
    if (await isElectronSecureAvailable()) {
      const b64 = await window.electronSecure!.encrypt(value);
      if (b64) {
        localStorage.setItem(fullKey, `${ELECTRON_SAFE_PREFIX}${b64}`);
        log.secureStorage('Value encrypted via Electron safeStorage', LogLevel.DEBUG, { key });
        return;
      }
      log.secureStorage('Electron safeStorage encrypt failed; falling back to web crypto', LogLevel.WARN, { key });
    }

    // Use AES-GCM encryption for web/desktop
    if (!isCryptoAvailable()) {
      log.secureStorage('Web Crypto API not available - cannot store credentials securely', LogLevel.ERROR, { key }
      );
      throw new Error(
        'Secure storage not available. Please use a modern browser that supports Web Crypto API (Chrome, Firefox, Safari, Edge).'
      );
    }

    try {
      const encrypted = await encrypt(value);
      localStorage.setItem(fullKey, encrypted);
      log.secureStorage('Value encrypted and stored in localStorage', LogLevel.DEBUG, { key });
    } catch (error) {
      log.secureStorage('Failed to encrypt value', LogLevel.ERROR, { key, error });
      throw new Error('Failed to securely store value');
    }
  }
}

/**
 * Retrieve a value securely.
 * 
 * @param key - The identifier for the value
 * @returns The decrypted value, or null if not found
 */
export async function getSecureValue(key: string): Promise<string | null> {
  const fullKey = `${STORAGE_PREFIX}${key}`;

  if (isNativePlatform()) {
    // Retrieve from SecureStorage (Keychain/Keystore)
    log.secureStorage('Retrieving from native secure storage', LogLevel.DEBUG, {
      key,
      platform: Capacitor.getPlatform(),
    });
    try {
      const value = await SecureStorage.get(fullKey);
      // We only store strings, so cast DataType to string
      return value as string | null;
    } catch {
      // Key doesn't exist or error occurred
      log.secureStorage('Key not found in native secure storage', LogLevel.DEBUG, { key, });
      return null;
    }
  } else {
    // Retrieve and decrypt from localStorage
    const encrypted = localStorage.getItem(fullKey);
    if (!encrypted) {
      return null;
    }

    // Electron safeStorage blob: decrypt via the OS-backed bridge.
    if (encrypted.startsWith(ELECTRON_SAFE_PREFIX)) {
      if (await isElectronSecureAvailable()) {
        const decrypted = await window.electronSecure!.decrypt(encrypted.slice(ELECTRON_SAFE_PREFIX.length));
        return decrypted;
      }
      log.secureStorage('Electron safeStorage blob found but bridge unavailable; cannot decrypt', LogLevel.WARN, { key });
      return null;
    }

    if (!isCryptoAvailable()) {
      log.secureStorage('Web Crypto API not available - cannot decrypt stored credentials', LogLevel.ERROR, { key }
      );
      log.secureStorage('Returning potentially unencrypted value from legacy storage. Please use a modern browser.', LogLevel.WARN, { key });
      // Return the value as-is (may be unencrypted from old storage)
      // This allows legacy data to still work but logs the security issue
      return encrypted;
    }

    try {
      const decrypted = await decrypt(encrypted);
      log.secureStorage('Value retrieved and decrypted from localStorage', LogLevel.DEBUG, { key });
      return decrypted;
    } catch {
      try {
        const legacyDecrypted = await decryptLegacy(encrypted);
        const reencrypted = await encrypt(legacyDecrypted);
        localStorage.setItem(fullKey, reencrypted);
        log.secureStorage('Migrated legacy encrypted value to new key', LogLevel.INFO, { key, });
        return legacyDecrypted;
      } catch (error) {
        log.secureStorage('Failed to decrypt value', LogLevel.ERROR, { key, error });
        if (isProbablyEncryptedPayload(encrypted)) {
          log.secureStorage('Encrypted value could not be decrypted; returning null to force re-auth', LogLevel.WARN, { key }
          );
          return null;
        }
        log.secureStorage('Returning raw value - may be unencrypted legacy data', LogLevel.WARN, { key });
        // Return raw value as fallback for legacy plaintext
        return encrypted;
      }
    }
  }
}

/**
 * Remove a value from secure storage.
 * 
 * @param key - The identifier for the value to remove
 */
export async function removeSecureValue(key: string): Promise<void> {
  const fullKey = `${STORAGE_PREFIX}${key}`;

  if (isNativePlatform()) {
    log.secureStorage('Removing from native secure storage', LogLevel.DEBUG, {
      key,
      platform: Capacitor.getPlatform(),
    });
    try {
      await SecureStorage.remove(fullKey);
    } catch {
      // Key might not exist, which is fine
      log.secureStorage('Key not found during removal (already deleted?)', LogLevel.DEBUG, { key, });
    }
  } else {
    log.secureStorage('Removing from localStorage', LogLevel.DEBUG, { key });
    localStorage.removeItem(fullKey);
  }
}

/**
 * Check if a value exists in secure storage.
 * 
 * @param key - The identifier to check
 */
export async function hasSecureValue(key: string): Promise<boolean> {
  const fullKey = `${STORAGE_PREFIX}${key}`;

  if (isNativePlatform()) {
    try {
      const value = await SecureStorage.get(fullKey);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  } else {
    return localStorage.getItem(fullKey) !== null;
  }
}

/**
 * Clear all secure values managed by this app.
 * Useful for logout or app reset.
 */
export async function clearSecureStorage(): Promise<void> {
  if (isNativePlatform()) {
    log.secureStorage('Clearing all secure storage (native)', LogLevel.DEBUG, { platform: Capacitor.getPlatform(), });
    try {
      // SecureStorage.clear() removes ALL keys, not just ours with prefix
      // So we use keys() to get all keys and filter for our prefix
      const allKeys = await SecureStorage.keys();
      const ourKeys = allKeys.filter((key) => key.startsWith(STORAGE_PREFIX));

      for (const key of ourKeys) {
        try {
          await SecureStorage.remove(key);
        } catch {
          log.secureStorage('Failed to remove key during clear', LogLevel.WARN, { key, });
        }
      }

      log.secureStorage('Native secure storage cleared', LogLevel.DEBUG, { keysRemoved: ourKeys.length, });
    } catch (error) {
      log.secureStorage('Failed to clear native secure storage', LogLevel.ERROR, { error });
    }
  } else {
    log.secureStorage('Clearing all secure storage (web)', LogLevel.DEBUG);
    // Remove all keys starting with our prefix
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }
}

/**
 * Get storage type info (for debugging/settings).
 */
export function getStorageInfo(): {
  platform: 'native' | 'web';
  method: string;
  details: string;
} {
  const platformName = Capacitor.getPlatform();

  if (isNativePlatform()) {
    const details =
      platformName === 'ios'
        ? 'iOS Keychain (hardware-encrypted)'
        : 'Android Keystore with AES-256-GCM';

    return {
      platform: 'native',
      method: '@aparajita/capacitor-secure-storage',
      details,
    };
  } else {
    return {
      platform: 'web',
      method: isCryptoAvailable()
        ? 'AES-GCM obfuscation (Web Crypto API)'
        : 'Unencrypted localStorage (fallback)',
      details: isCryptoAvailable()
        ? 'Key material is stored alongside the ciphertext; obfuscation, not confidentiality against a local reader'
        : 'WARNING: No encryption available',
    };
  }
}
