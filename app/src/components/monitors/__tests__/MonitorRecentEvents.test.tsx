/**
 * MonitorRecentEvents thumbnail-chain profile scoping (refs #337 I2).
 *
 * On the All-mode deep route this component receives an explicit profileId
 * for a profile that may differ from whichever profile is globally current.
 * Thumbnail URLs must be built against THAT profile's token, never the
 * current profile's - otherwise a cross-profile token gets sent to the
 * wrong host.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MonitorRecentEvents } from '../MonitorRecentEvents';
import type { Event, Monitor } from '../../../api/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useProfileById: (profileId?: string) => ({
    profile: { id: profileId ?? 'current-profile', portalUrl: 'https://portal.test' },
    settings: {
      thumbnailFallbackChain: [],
      eventsThumbnailFit: 'contain',
      forceDisableMultiPort: false,
    },
  }),
}));

vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: 'tok', isFresh: true }),
}));

vi.mock('../../../stores/monitorSeen', () => ({
  useMonitorSeenStore: (sel: (s: { markSeen: () => void }) => unknown) => sel({ markSeen: vi.fn() }),
}));

const useMonitorRecentEventsMock = vi.fn();
vi.mock('../../../hooks/useMonitorRecentEvents', () => ({
  useMonitorRecentEvents: (...args: unknown[]) => useMonitorRecentEventsMock(...args),
}));

const buildThumbnailChainForEventMock = vi.fn(() => ['url1']);
vi.mock('../../../lib/event/thumbnail-chain', () => ({
  buildThumbnailChainForEvent: (...args: unknown[]) => buildThumbnailChainForEventMock(...args),
  eventHasAlarmFrame: () => false,
}));

vi.mock('../../events/CompactEventRow', () => ({ CompactEventRow: () => <div data-testid="event-row" /> }));

const monitor: Monitor = {
  Id: '5',
  Name: 'Front Door',
  Width: '640',
  Height: '480',
} as Monitor;

const event: Event = {
  Id: 'e1',
  MonitorId: '5',
  StartDateTime: '2026-01-01 00:00:00',
} as Event;

describe('MonitorRecentEvents thumbnail-chain profile scoping (refs #337 I2)', () => {
  beforeEach(() => {
    buildThumbnailChainForEventMock.mockClear();
    useMonitorRecentEventsMock.mockReset();
    useMonitorRecentEventsMock.mockReturnValue({
      events: [{ Event: event }],
      isLoading: false,
      isError: false,
      isFetching: false,
      hidden: false,
      count: 5,
      toggleHidden: vi.fn(),
      refetch: vi.fn(),
    });
  });

  it('builds the thumbnail chain with the deep route profileId, not the current profile', () => {
    render(<MonitorRecentEvents monitor={monitor} profileId="profile-b" />);

    expect(buildThumbnailChainForEventMock).toHaveBeenCalledTimes(1);
    const options = buildThumbnailChainForEventMock.mock.calls[0][5] as { profileId?: string };
    expect(options.profileId).toBe('profile-b');
  });
});
