import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../theme-provider';

const mocks = vi.hoisted(() => ({
  syncNativeWindowBackground: vi.fn(),
  syncNativeSystemBarsStyle: vi.fn(),
}));

vi.mock('../../lib/native-window-theme', () => ({
  syncNativeWindowBackground: mocks.syncNativeWindowBackground,
  syncNativeSystemBarsStyle: mocks.syncNativeSystemBarsStyle,
}));

describe('ThemeProvider native theme sync', () => {
  beforeEach(() => {
    mocks.syncNativeWindowBackground.mockClear();
    mocks.syncNativeSystemBarsStyle.mockClear();
    // jsdom has no matchMedia; the "system" branch reads it.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('applies the window background after the bar style, so it is not overwritten', () => {
    render(<ThemeProvider defaultTheme="dark"><div /></ThemeProvider>);

    // Capacitor's SystemBars.setStyle repaints the decor view with the Android
    // theme's windowBackground as its last step, so a background set before it
    // is lost. Order is the fix, not a style preference (refs #356).
    const styleCall = mocks.syncNativeSystemBarsStyle.mock.invocationCallOrder[0];
    const backgroundCall = mocks.syncNativeWindowBackground.mock.invocationCallOrder[0];
    expect(styleCall).toBeLessThan(backgroundCall);
  });

  it('runs both syncs for the system theme', () => {
    render(<ThemeProvider defaultTheme="system"><div /></ThemeProvider>);

    expect(mocks.syncNativeSystemBarsStyle).toHaveBeenCalled();
    expect(mocks.syncNativeWindowBackground).toHaveBeenCalled();
  });
});
