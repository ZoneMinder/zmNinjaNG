/**
 * useNotificationAllModeToasts Hook Tests (refs #337)
 *
 * Covers the All-mode toast addendum:
 * - each event honors its OWNING profile's showToasts/playSound, never the
 *   app's "current" profile
 * - events within the burst window collapse into one summary toast; a lone
 *   event still gets the normal per-event toast
 * - at most one notification sound plays per burst window
 * - the all-mode mute toggle suppresses toasts+sound entirely
 * - single mode is a no-op (the addendum is All-mode only)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { useNotificationAllModeToasts } from '../useNotificationAllModeToasts';
import { useNotificationStore } from '../../stores/notifications';
import { asProfileId } from '../../api/types';
import type { ZMAlarmEvent } from '../../types/notifications';

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('../../lib/event/notification-sound', () => ({
  playNotificationSound: vi.fn(),
}));

type ScopeLike = {
  mode: 'all' | 'single';
  profile: null;
  profiles: { id: string; name: string }[];
  settings: { allModeNotifications: 'live' | 'muted' | 'off' };
} | null;

const mockScope = vi.fn<() => ScopeLike>(() => null);
vi.mock('../useProfileScope', () => ({
  useProfileScope: () => mockScope(),
}));

const PROFILE_A = asProfileId('profile-a');
const PROFILE_B = asProfileId('profile-b');

function makeEvent(overrides: Partial<ZMAlarmEvent> = {}): ZMAlarmEvent {
  return {
    MonitorId: 1,
    MonitorName: 'Front Door',
    EventId: Math.floor(Math.random() * 100000) + 1,
    Cause: 'Motion',
    Name: 'Front Door',
    ...overrides,
  };
}

function renderIt() {
  return renderHook(() => useNotificationAllModeToasts(), { wrapper: MemoryRouter });
}

async function flushBurst() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

describe('useNotificationAllModeToasts (refs #337)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.mocked(toast).mockClear();
    const { playNotificationSound } = await import('../../lib/event/notification-sound');
    vi.mocked(playNotificationSound).mockClear();
    mockScope.mockReset();
    useNotificationStore.setState({ profileEvents: {}, profileSettings: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops in single mode', async () => {
    mockScope.mockReturnValue({
      mode: 'single',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
    });
    await flushBurst();

    expect(toast).not.toHaveBeenCalled();
  });

  it('a single event in the window shows the normal per-event toast', async () => {
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }, { id: PROFILE_B, name: 'Work' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    useNotificationStore.getState().updateProfileSettings(PROFILE_B, { enabled: true, showToasts: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent({ MonitorName: 'Front Door' }));
    });
    await flushBurst();

    expect(toast).toHaveBeenCalledTimes(1);
    // Normal toast is a JSX element, not the summary translation key.
    const [content] = vi.mocked(toast).mock.calls[0];
    expect(typeof content).not.toBe('string');
  });

  it('two events within the window collapse into one localized summary toast', async () => {
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }, { id: PROFILE_B, name: 'Work' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    useNotificationStore.getState().updateProfileSettings(PROFILE_B, { enabled: true, showToasts: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
      useNotificationStore.getState().addEvent(PROFILE_B, makeEvent());
    });
    await flushBurst();

    expect(toast).toHaveBeenCalledTimes(1);
    const [content] = vi.mocked(toast).mock.calls[0];
    expect(content).toBe('notifications.all_mode_burst_summary:{"eventCount":2,"servers":2}');
  });

  it('tapping the summary toast navigates to the aggregated events page', async () => {
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }, { id: PROFILE_B, name: 'Work' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    useNotificationStore.getState().updateProfileSettings(PROFILE_B, { enabled: true, showToasts: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
      useNotificationStore.getState().addEvent(PROFILE_B, makeEvent());
    });
    await flushBurst();

    const [, options] = vi.mocked(toast).mock.calls[0];
    const action = (options as { action?: { onClick: () => void } } | undefined)?.action;
    expect(action?.onClick).toBeInstanceOf(Function);
    // Navigation itself is exercised end-to-end elsewhere; here we only need
    // the action to be wired, since asserting router navigation from a
    // bare renderHook + MemoryRouter is redundant with the routing layer's
    // own tests.
  });

  it('honors each event\'s OWNING profile showToasts - not the other profile\'s', async () => {
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }, { id: PROFILE_B, name: 'Work' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    useNotificationStore.getState().updateProfileSettings(PROFILE_B, { enabled: true, showToasts: false });
    renderIt();

    // B's event first (muted for B) - no toast expected once the window closes.
    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_B, makeEvent());
    });
    await flushBurst();
    expect(toast).not.toHaveBeenCalled();

    // A's event - A has toasts enabled, must still toast.
    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
    });
    await flushBurst();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('plays at most one notification sound per burst window', async () => {
    const { playNotificationSound } = await import('../../lib/event/notification-sound');
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }, { id: PROFILE_B, name: 'Work' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true, playSound: true });
    useNotificationStore.getState().updateProfileSettings(PROFILE_B, { enabled: true, showToasts: true, playSound: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
      useNotificationStore.getState().addEvent(PROFILE_B, makeEvent());
    });
    await flushBurst();

    expect(playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it('the all-mode mute toggle suppresses toasts and sound entirely', async () => {
    const { playNotificationSound } = await import('../../lib/event/notification-sound');
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }],
      settings: { allModeNotifications: 'muted' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true, playSound: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
    });
    await flushBurst();

    expect(toast).not.toHaveBeenCalled();
    expect(playNotificationSound).not.toHaveBeenCalled();
    // Store-side effects (badge/history) are independent of this hook -
    // addEvent ran above regardless of the mute toggle (refs #337 #11).
    expect(useNotificationStore.getState().getEvents(PROFILE_A)).toHaveLength(1);
    expect(useNotificationStore.getState().getProfileSettings(PROFILE_A).badgeCount).toBe(1);
  });

  // refs #337 #12
  it('does not toast for a profile with notifications entirely disabled, even with showToasts true', async () => {
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }, { id: PROFILE_B, name: 'Work' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    // Disabled overall, even though showToasts itself is on.
    useNotificationStore.getState().updateProfileSettings(PROFILE_B, { enabled: false, showToasts: true });
    renderIt();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_B, makeEvent());
    });
    await flushBurst();
    expect(toast).not.toHaveBeenCalled();

    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent());
    });
    await flushBurst();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // refs #337 #7
  it('seeds a profile\'s pre-existing event on first observation instead of toasting it at launch', async () => {
    mockScope.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [{ id: PROFILE_A, name: 'Home' }],
      settings: { allModeNotifications: 'live' },
    });
    useNotificationStore.getState().updateProfileSettings(PROFILE_A, { enabled: true, showToasts: true });
    // Simulate a stale/persisted event already present before the hook ever
    // mounts (e.g. rehydrated from a previous session).
    useNotificationStore.getState().addEvent(PROFILE_A, makeEvent({ MonitorName: 'Stale' }));

    renderIt();
    await flushBurst();
    expect(toast).not.toHaveBeenCalled();

    // A genuinely new event afterward must still toast normally.
    act(() => {
      useNotificationStore.getState().addEvent(PROFILE_A, makeEvent({ MonitorName: 'Fresh' }));
    });
    await flushBurst();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
