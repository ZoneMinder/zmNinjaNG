import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncNativeSystemBarsStyle } from '../native-window-theme';

const mocks = vi.hoisted(() => ({
  platform: { value: 'android' },
  setStyle: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform.value,
    isNativePlatform: () => mocks.platform.value !== 'web',
  },
  registerPlugin: () =>
    new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) }),
  SystemBars: {
    setStyle: (options: unknown) => mocks.setStyle(options),
  },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));

describe('syncNativeSystemBarsStyle', () => {
  beforeEach(() => {
    mocks.platform.value = 'android';
    mocks.setStyle.mockReset();
    mocks.setStyle.mockResolvedValue(undefined);
    document.documentElement.classList.remove('light', 'dark', 'slate', 'amber', 'cream');
  });

  it('sets DARK style (light icons) when the effective theme is dark', () => {
    document.documentElement.classList.add('dark');
    syncNativeSystemBarsStyle();
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
  });

  it('sets DARK style for composite dark themes (slate)', () => {
    document.documentElement.classList.add('dark', 'slate');
    syncNativeSystemBarsStyle();
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
  });

  it('sets LIGHT style (dark icons) when the effective theme is light', () => {
    document.documentElement.classList.add('light');
    syncNativeSystemBarsStyle();
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('does nothing off Android', () => {
    mocks.platform.value = 'web';
    document.documentElement.classList.add('dark');
    syncNativeSystemBarsStyle();
    expect(mocks.setStyle).not.toHaveBeenCalled();

    mocks.platform.value = 'ios';
    syncNativeSystemBarsStyle();
    expect(mocks.setStyle).not.toHaveBeenCalled();
  });

  it('does not throw when the native call rejects', async () => {
    document.documentElement.classList.add('dark');
    mocks.setStyle.mockRejectedValue(new Error('native unavailable'));
    expect(() => syncNativeSystemBarsStyle()).not.toThrow();
    await vi.waitFor(() => expect(mocks.setStyle).toHaveBeenCalled());
  });
});
