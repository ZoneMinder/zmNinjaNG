/**
 * Kiosk PIN Utility
 *
 * Handles hashing, storing, and verifying the global kiosk mode PIN.
 * Uses SHA-256 with a random salt. PIN hash and salt are stored
 * in secure storage (Keychain/Keystore on mobile, encrypted localStorage on web).
 */

import { setSecureValue, getSecureValue, hasSecureValue, removeSecureValue } from './security/secureStorage';
import { log, LogLevel } from './logger';

const PIN_HASH_KEY = 'kiosk_pin_hash';
const PIN_SALT_KEY = 'kiosk_pin_salt';

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export async function storePin(pin: string): Promise<void> {
  const salt = generateSalt();
  const hash = await hashPin(pin, salt);
  await setSecureValue(PIN_HASH_KEY, hash);
  await setSecureValue(PIN_SALT_KEY, salt);
  log.secureStorage('Kiosk PIN stored', LogLevel.INFO);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const storedHash = await getSecureValue(PIN_HASH_KEY);
  const storedSalt = await getSecureValue(PIN_SALT_KEY);

  if (!storedHash || !storedSalt) {
    log.secureStorage('No kiosk PIN found in storage', LogLevel.WARN);
    return false;
  }

  const hash = await hashPin(pin, storedSalt);
  return hash === storedHash;
}

export async function hasPinStored(): Promise<boolean> {
  return hasSecureValue(PIN_HASH_KEY);
}

export async function clearPin(): Promise<void> {
  await removeSecureValue(PIN_HASH_KEY);
  await removeSecureValue(PIN_SALT_KEY);
  log.secureStorage('Kiosk PIN cleared', LogLevel.INFO);
}
