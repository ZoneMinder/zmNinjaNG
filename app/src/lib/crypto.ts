/**
 * Encryption Utility
 *
 * AES-GCM encoding for stored secrets in environments without native secure
 * storage (web browser, Electron renderer).
 *
 * This is obfuscation, not confidentiality. The PBKDF2 key material is a random
 * value kept in localStorage next to the ciphertext (getPersistentSalt), so a
 * reader of localStorage has everything needed to decrypt. It defeats casual
 * inspection (a plaintext grep), not an attacker with read access to the store.
 * There is no browser key store to bind to. On native (iOS/Android) the
 * Capacitor Secure Storage plugin (Keychain/Keystore) is used instead and is
 * the only path with real at-rest confidentiality.
 */

import { log, LogLevel } from './logger';
import { STORAGE_KEYS } from './zmninja-ng-constants';

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const PBKDF2_SALT = 'zmng-v1';
const PBKDF2_ITERATIONS = 100000;

export const MIN_ENCRYPTED_BYTES = IV_LENGTH + 1;

function getPersistentSalt(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'zmng-fallback-salt';
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEYS.cryptoSalt);
    if (existing) {
      return existing;
    }

    const randomBytes = window.crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...randomBytes));
    window.localStorage.setItem(STORAGE_KEYS.cryptoSalt, salt);
    return salt;
  } catch {
    return 'zmng-fallback-salt';
  }
}

async function deriveKey(keyMaterialString: string, salt: string): Promise<CryptoKey> {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterialString),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive the AES-GCM key. The key material is the per-install random value from
 * getPersistentSalt(), which lives in localStorage alongside the ciphertext, so
 * this is not a secret an attacker with store access lacks. See the file header.
 *
 * @returns Promise resolving to a CryptoKey
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const persistentSalt = getPersistentSalt();
  return deriveKey(persistentSalt, PBKDF2_SALT);
}

async function getLegacyEncryptionKey(): Promise<CryptoKey> {
  const legacyMaterial = `${PBKDF2_SALT}${navigator.userAgent}`;
  return deriveKey(legacyMaterial, PBKDF2_SALT);
}

async function decryptWithKey(encryptedData: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv: iv,
    },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt a string value.
 * 
 * @param plaintext - The string to encrypt
 * @returns Base64 encoded string containing IV + Ciphertext
 */
export async function encrypt(plaintext: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encodedText = new TextEncoder().encode(plaintext);

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: iv,
      },
      key,
      encodedText
    );

    // Combine IV and ciphertext, then base64 encode
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    log.crypto('Encryption failed', LogLevel.ERROR, error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt a string value.
 * 
 * @param encryptedData - Base64 encoded string containing IV + Ciphertext
 * @returns The original plaintext string
 */
export async function decrypt(encryptedData: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    return await decryptWithKey(encryptedData, key);
  } catch (error) {
    log.crypto('Decryption failed', LogLevel.ERROR, error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Decrypt using the legacy key derivation (pre persistent-salt).
 */
export async function decryptLegacy(encryptedData: string): Promise<string> {
  try {
    const key = await getLegacyEncryptionKey();
    return await decryptWithKey(encryptedData, key);
  } catch (error) {
    log.crypto('Legacy decryption failed', LogLevel.ERROR, error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Best-effort check for encrypted payloads generated by this module.
 */
export function isProbablyEncryptedPayload(value: string): boolean {
  try {
    const combined = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return combined.length >= MIN_ENCRYPTED_BYTES;
  } catch {
    return false;
  }
}

/**
 * Check if Web Crypto API is available in the current environment.
 */
export function isCryptoAvailable(): boolean {
  return typeof window !== 'undefined' &&
         typeof window.crypto !== 'undefined' &&
         typeof window.crypto.subtle !== 'undefined';
}
