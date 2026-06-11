/**
 * Tests for the PinPad auto-submit timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PinPad } from '../PinPad';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function enterPin(pin: string): void {
  for (const digit of pin) {
    fireEvent.click(screen.getByTestId(`kiosk-pin-digit-${digit}`));
  }
}

describe('PinPad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-submits 100ms after the fourth digit', () => {
    const onSubmit = vi.fn();
    render(<PinPad mode="unlock" onSubmit={onSubmit} onCancel={() => {}} />);

    enterPin('1234');
    expect(onSubmit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('1234');
  });

  it('does not submit when unmounted before the timer fires', () => {
    const onSubmit = vi.fn();
    const { unmount } = render(
      <PinPad mode="unlock" onSubmit={onSubmit} onCancel={() => {}} />
    );

    enterPin('1234');
    unmount();

    vi.advanceTimersByTime(200);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
