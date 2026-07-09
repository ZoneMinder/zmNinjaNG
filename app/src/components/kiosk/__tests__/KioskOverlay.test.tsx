/**
 * KioskOverlay Component Tests
 *
 * The overlay reads three reactive fields from the kiosk store: isLocked (mount/unmount),
 * cooldownUntil (PIN pad countdown), and unlockRequested (sidebar-driven unlock).
 * Each test drives the real store through an action and asserts the DOM moved, so a
 * subscription that drops any of the three fails here instead of in production.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { KioskOverlay } from '../KioskOverlay';
import { useKioskStore } from '../../../stores/kioskStore';
import { KIOSK } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/logger', () => ({
  log: { kiosk: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../../../lib/platform', () => ({
  Platform: { isNative: false },
}));

vi.mock('../../../hooks/useCapacitorListener', () => ({
  useCapacitorListener: () => undefined,
}));

vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../../../lib/kioskPin', () => ({
  verifyPin: vi.fn(async () => false),
}));

// No biometrics in the test environment, so an unlock tap always falls through to the PIN pad.
vi.mock('../../../hooks/useBiometricAuth', () => ({
  checkBiometricAvailability: vi.fn(async () => false),
  authenticateWithBiometrics: vi.fn(async () => ({ success: false })),
}));

vi.mock('../PinPad', () => ({
  PinPad: ({ cooldownSeconds }: { cooldownSeconds?: number }) => (
    <div data-testid="pin-pad">
      {cooldownSeconds !== undefined && (
        <span data-testid="pin-pad-cooldown">{cooldownSeconds}</span>
      )}
    </div>
  ),
}));

function resetKioskStore() {
  useKioskStore.setState({
    isLocked: false,
    previousInsomniaState: false,
    pinAttempts: 0,
    cooldownUntil: null,
    unlockRequested: false,
  });
}

describe('KioskOverlay', () => {
  beforeEach(() => {
    resetKioskStore();
  });

  it('mounts the overlay when the store locks and removes it when the store unlocks', () => {
    render(<KioskOverlay onUnlock={vi.fn()} />);
    expect(screen.queryByTestId('kiosk-overlay')).not.toBeInTheDocument();

    act(() => useKioskStore.getState().lock(false));
    expect(screen.getByTestId('kiosk-overlay')).toBeInTheDocument();

    act(() => useKioskStore.getState().unlock());
    expect(screen.queryByTestId('kiosk-overlay')).not.toBeInTheDocument();
  });

  it('opens the PIN pad when another component requests an unlock, and clears the request', async () => {
    render(<KioskOverlay onUnlock={vi.fn()} />);
    act(() => useKioskStore.getState().lock(false));
    expect(screen.queryByTestId('pin-pad')).not.toBeInTheDocument();

    act(() => useKioskStore.getState().requestUnlock());

    await waitFor(() => expect(screen.getByTestId('pin-pad')).toBeInTheDocument());
    expect(useKioskStore.getState().unlockRequested).toBe(false);
  });

  it('shows the remaining cooldown on the PIN pad once attempts are exhausted', async () => {
    render(<KioskOverlay onUnlock={vi.fn()} />);
    act(() => useKioskStore.getState().lock(false));
    act(() => useKioskStore.getState().requestUnlock());
    await waitFor(() => expect(screen.getByTestId('pin-pad')).toBeInTheDocument());

    expect(screen.queryByTestId('pin-pad-cooldown')).not.toBeInTheDocument();

    act(() => {
      for (let i = 0; i < KIOSK.maxPinAttempts; i++) {
        useKioskStore.getState().recordFailedAttempt();
      }
    });

    const cooldown = await screen.findByTestId('pin-pad-cooldown');
    expect(Number(cooldown.textContent)).toBeGreaterThan(0);
  });
});
