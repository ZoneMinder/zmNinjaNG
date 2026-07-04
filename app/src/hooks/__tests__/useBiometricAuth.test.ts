/**
 * useBiometricAuth tests.
 *
 * checkBiometricAvailability/authenticateWithBiometrics wrap
 * @aparajita/capacitor-biometric-auth (mocked globally in tests/setup.ts).
 * Covers the available/unavailable, success/deny/error paths that gate
 * whether the app falls back to PIN entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { checkBiometricAvailability, authenticateWithBiometrics } from '../useBiometricAuth';

vi.mock('../../lib/logger', () => ({
  log: { auth: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

describe('checkBiometricAvailability', () => {
  beforeEach(() => {
    vi.mocked(BiometricAuth.checkBiometry).mockReset();
  });

  it('returns true when the platform reports biometrics are available', async () => {
    vi.mocked(BiometricAuth.checkBiometry).mockResolvedValue({
      isAvailable: true,
      biometryType: 2,
      reason: '',
    } as never);

    await expect(checkBiometricAvailability()).resolves.toBe(true);
  });

  it('returns false when the platform reports biometrics are unavailable', async () => {
    vi.mocked(BiometricAuth.checkBiometry).mockResolvedValue({
      isAvailable: false,
      biometryType: 0,
      reason: 'No biometric hardware',
    } as never);

    await expect(checkBiometricAvailability()).resolves.toBe(false);
  });

  it('returns false (does not throw) when the platform check itself fails', async () => {
    vi.mocked(BiometricAuth.checkBiometry).mockRejectedValue(new Error('plugin not implemented on web'));

    await expect(checkBiometricAvailability()).resolves.toBe(false);
  });
});

describe('authenticateWithBiometrics', () => {
  beforeEach(() => {
    vi.mocked(BiometricAuth.authenticate).mockReset();
  });

  it('resolves with success=true when authentication succeeds', async () => {
    vi.mocked(BiometricAuth.authenticate).mockResolvedValue(undefined);

    await expect(authenticateWithBiometrics('Unlock zmNinjaNg')).resolves.toEqual({ success: true });
    expect(BiometricAuth.authenticate).toHaveBeenCalledWith({
      reason: 'Unlock zmNinjaNg',
      cancelTitle: 'Use PIN',
      allowDeviceCredential: false,
    });
  });

  it('resolves with success=false and the error message when the user denies/cancels', async () => {
    vi.mocked(BiometricAuth.authenticate).mockRejectedValue(new Error('User cancelled biometric authentication'));

    await expect(authenticateWithBiometrics('Unlock zmNinjaNg')).resolves.toEqual({
      success: false,
      error: 'User cancelled biometric authentication',
    });
  });

  it('falls back to a generic message when the rejection is not an Error instance', async () => {
    vi.mocked(BiometricAuth.authenticate).mockRejectedValue('native bridge failure');

    await expect(authenticateWithBiometrics('Unlock zmNinjaNg')).resolves.toEqual({
      success: false,
      error: 'Biometric auth failed',
    });
  });

  it('never rejects the returned promise, even when the native call throws', async () => {
    vi.mocked(BiometricAuth.authenticate).mockRejectedValue(new Error('boom'));
    const result = await authenticateWithBiometrics('reason');
    expect(result.success).toBe(false);
  });
});
