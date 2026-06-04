import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SafeAreaInsets = { top: number; right: number; bottom: number; left: number };
type Listener = (insets: SafeAreaInsets) => void;

// Hoisted handles so the module mocks (evaluated before imports) and the
// per-test setup share the same mock functions and platform flag.
const h = vi.hoisted(() => ({
  platform: 'ios',
  getInsets: vi.fn<() => Promise<SafeAreaInsets>>(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform, isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));

vi.mock('../../plugins/safe-area', () => ({
  SafeArea: { getInsets: h.getInsets, addListener: h.addListener },
}));

describe('installSafeAreaBootstrap', () => {
  let appliedLogs: number;
  let listener: Listener | undefined;
  let installSafeAreaBootstrap: () => Promise<void>;

  beforeEach(async () => {
    // Reset the module registry so safe-area-bootstrap's internal change-tracking
    // state (lastAppliedKey) starts fresh for every test.
    vi.resetModules();
    listener = undefined;
    appliedLogs = 0;
    h.platform = 'ios';

    h.getInsets.mockResolvedValue({ top: 62, right: 0, bottom: 34, left: 0 });
    h.addListener.mockImplementation((_event: string, cb: Listener) => {
      listener = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    // Import the logger from the post-reset registry so the spy matches the
    // instance the bootstrap module will use.
    const { log } = await import('../logger');
    vi.spyOn(log, 'app').mockImplementation((message: string) => {
      if (message.startsWith('[SafeArea] applied')) appliedLogs += 1;
    });

    ({ installSafeAreaBootstrap } = await import('../safe-area-bootstrap'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns early on non-iOS platforms', async () => {
    h.platform = 'web';
    await installSafeAreaBootstrap();
    expect(h.getInsets).not.toHaveBeenCalled();
  });

  it('writes insets to CSS custom properties on the document root', async () => {
    await installSafeAreaBootstrap();

    expect(document.documentElement.style.getPropertyValue('--sai-top')).toBe('62px');
    expect(document.documentElement.style.getPropertyValue('--sai-bottom')).toBe('34px');
  });

  it('logs once for the initial insets and skips unchanged re-emits', async () => {
    await installSafeAreaBootstrap();
    expect(appliedLogs).toBe(1); // initial-getInsets

    // Native re-emits the same values on every foreground; these must not log.
    listener?.({ top: 62, right: 0, bottom: 34, left: 0 });
    listener?.({ top: 62, right: 0, bottom: 34, left: 0 });
    expect(appliedLogs).toBe(1);
  });

  it('logs again when the insets actually change', async () => {
    await installSafeAreaBootstrap();
    expect(appliedLogs).toBe(1);

    // Rotation: left/right swap with top/bottom. New values must log.
    listener?.({ top: 0, right: 62, bottom: 21, left: 62 });
    expect(appliedLogs).toBe(2);

    // Same again: no new log.
    listener?.({ top: 0, right: 62, bottom: 21, left: 62 });
    expect(appliedLogs).toBe(2);
  });

  it('applies updated insets to the CSS variables on change', async () => {
    await installSafeAreaBootstrap();

    listener?.({ top: 0, right: 62, bottom: 21, left: 62 });
    expect(document.documentElement.style.getPropertyValue('--sai-left')).toBe('62px');
    expect(document.documentElement.style.getPropertyValue('--sai-top')).toBe('0px');
  });
});
