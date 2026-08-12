/**
 * MonitorHoverPreview profile threading (refs #337).
 *
 * Mirrors LiveMonitorPlayer's profileId prop: an All-mode card passes the
 * owning profile's id so the hover preview streams from that profile's
 * server, not the globally-selected one. `HoverPreview` itself owns the
 * hover-timing/portal mechanics and is stubbed here to open immediately, so
 * these tests exercise only MonitorHoverPreview/MonitorLivePreview's own
 * profile resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MonitorHoverPreview } from '../MonitorHoverPreview';
import { useProfileStore } from '../../../stores/profile';
import type { Monitor, Profile } from '../../../api/types';
import { asProfileId } from '../../../api/types';

vi.mock('../../ui/hover-preview', () => ({
  HoverPreview: ({ renderPreview }: { renderPreview: () => React.ReactNode }) => (
    <div data-testid="stub-preview">{renderPreview()}</div>
  ),
}));

const streamLifecycleCalls: Array<{ monitorId?: string; profileId?: string | null }> = [];
vi.mock('../../../hooks/useStreamLifecycle', () => ({
  useStreamLifecycle: (opts: { monitorId?: string; profileId?: string | null }) => {
    streamLifecycleCalls.push({ monitorId: opts.monitorId, profileId: opts.profileId });
    return { connKey: 42, forceRegenerate: vi.fn(), releaseConnection: vi.fn() };
  },
}));

const freshTokenCalls: Array<string | null | undefined> = [];
vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: (profileId?: string | null) => {
    freshTokenCalls.push(profileId);
    return { token: 'tok', isFresh: true };
  },
}));

vi.mock('../../../lib/logger', () => ({
  log: { monitor: vi.fn() },
}));

const monitor = { Id: 'mon-1', Name: 'Front Door', Width: 1920, Height: 1080 } as unknown as Monitor;

const profileA: Profile = {
  id: asProfileId('profile-a'),
  name: 'A',
  apiUrl: 'https://a',
  portalUrl: 'https://a',
  cgiUrl: 'https://a/cgi-bin',
  isDefault: true,
  createdAt: 0,
};

const profileB: Profile = {
  id: asProfileId('profile-b'),
  name: 'B',
  apiUrl: 'https://b',
  portalUrl: 'https://b',
  cgiUrl: 'https://b/cgi-bin',
  isDefault: false,
  createdAt: 0,
};

describe('MonitorHoverPreview profile threading', () => {
  beforeEach(() => {
    streamLifecycleCalls.length = 0;
    freshTokenCalls.length = 0;
    useProfileStore.setState({
      profiles: [profileA, profileB],
      currentProfileId: profileA.id,
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });
  });

  it('defaults to the current profile when no profileId prop is given (single mode)', () => {
    render(
      <MonitorHoverPreview monitor={monitor}>
        <div>trigger</div>
      </MonitorHoverPreview>,
    );

    expect(streamLifecycleCalls).toEqual([{ monitorId: 'mon-1', profileId: 'profile-a' }]);
    expect(freshTokenCalls).toEqual([undefined]);
  });

  it('streams from the owning profile when profileId is passed (All mode)', () => {
    render(
      <MonitorHoverPreview monitor={monitor} profileId={profileB.id}>
        <div>trigger</div>
      </MonitorHoverPreview>,
    );

    // The stream hook resolves against profile B even though the globally
    // selected profile is A.
    expect(streamLifecycleCalls).toEqual([{ monitorId: 'mon-1', profileId: 'profile-b' }]);
    expect(freshTokenCalls).toEqual(['profile-b']);
  });
});

// refs #352: the preview had no load or error handling at all, so a stream that
// never arrives left the browser's broken-image glyph sitting in the popover.
describe('MonitorHoverPreview frame gating', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [profileA],
      currentProfileId: profileA.id,
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });
  });

  const renderPreview = () =>
    render(
      <MonitorHoverPreview monitor={monitor}>
        <div>trigger</div>
      </MonitorHoverPreview>,
    );

  it('shows the no-video placeholder until the stream produces a frame', () => {
    const { getByTestId } = renderPreview();

    expect(getByTestId('monitor-hover-preview-img')).not.toBeVisible();
    expect(getByTestId('monitor-hover-preview-novideo')).toBeInTheDocument();
  });

  it('paints the stream once it loads', () => {
    const { getByTestId, queryByTestId } = renderPreview();

    fireEvent.load(getByTestId('monitor-hover-preview-img'));

    expect(getByTestId('monitor-hover-preview-img')).toBeVisible();
    expect(queryByTestId('monitor-hover-preview-novideo')).not.toBeInTheDocument();
  });

  it('falls back to the placeholder when the stream fails', () => {
    const { getByTestId } = renderPreview();
    fireEvent.load(getByTestId('monitor-hover-preview-img'));

    fireEvent.error(getByTestId('monitor-hover-preview-img'));

    expect(getByTestId('monitor-hover-preview-img')).not.toBeVisible();
    expect(getByTestId('monitor-hover-preview-novideo')).toBeInTheDocument();
  });
});
