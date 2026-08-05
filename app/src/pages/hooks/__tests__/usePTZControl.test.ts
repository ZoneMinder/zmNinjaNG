/**
 * usePTZControl tests.
 *
 * Regression coverage for #337 (All mode deep routes): when the caller passes
 * an explicit profileId (an /all/monitors/:profileId/:id detail page), PTZ
 * commands must go out through THAT profile's client, not whichever profile
 * happens to be globally current.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { asProfileId } from '../../../api/types';

const getSessionMock = vi.fn();
const getCurrentSessionMock = vi.fn();

vi.mock('../../../services/sessions', () => ({
  getSession: (id: string) => getSessionMock(id),
  getCurrentSession: () => getCurrentSessionMock(),
}));

vi.mock('../../../api/monitors', () => ({ controlMonitor: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('../../../lib/logger', () => ({
  log: { monitorDetail: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

import { controlMonitor } from '../../../api/monitors';
import { usePTZControl } from '../usePTZControl';

const profileB = asProfileId('profile-b');

describe('usePTZControl profile scoping (refs #337)', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getCurrentSessionMock.mockReset();
    getSessionMock.mockReturnValue({ client: 'client-b', profileId: profileB });
    getCurrentSessionMock.mockReturnValue({ client: 'client-current' });
    vi.mocked(controlMonitor).mockClear();
  });

  it('sends the command via the given profile\'s client when profileId is provided', async () => {
    const { result } = renderHook(() =>
      usePTZControl({
        portalUrl: 'https://portal.test',
        monitorId: 'mon-1',
        accessToken: 'tok',
        profileId: profileB,
      })
    );

    await act(async () => {
      await result.current.handlePTZCommand('up');
    });

    expect(getSessionMock).toHaveBeenCalledWith(profileB);
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
    expect(controlMonitor).toHaveBeenCalledWith(
      'client-b',
      'https://portal.test',
      'mon-1',
      'up',
      'tok',
      undefined
    );
  });

  it('falls back to the current session when profileId is omitted (single mode, zero change)', async () => {
    const { result } = renderHook(() =>
      usePTZControl({
        portalUrl: 'https://portal.test',
        monitorId: 'mon-1',
        accessToken: 'tok',
      })
    );

    await act(async () => {
      await result.current.handlePTZCommand('up');
    });

    expect(getCurrentSessionMock).toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(controlMonitor).toHaveBeenCalledWith(
      'client-current',
      'https://portal.test',
      'mon-1',
      'up',
      'tok',
      undefined
    );
  });
});
