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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { MonitorHoverPreview } from '../MonitorHoverPreview';
import type { Monitor } from '../../../api/types';
import * as freshTokenModule from '../../../hooks/useFreshAccessToken';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

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

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, monitor: vi.fn() } };
});

const monitor = { Id: 'mon-1', Name: 'Front Door', Width: 1920, Height: 1080 } as unknown as Monitor;

const profileA = makeProfile('profile-a', { name: 'A', apiUrl: 'https://a', portalUrl: 'https://a', cgiUrl: 'https://a/cgi-bin', isDefault: true });
const profileB = makeProfile('profile-b', { name: 'B', apiUrl: 'https://b', portalUrl: 'https://b', cgiUrl: 'https://b/cgi-bin' });

describe('MonitorHoverPreview profile threading', () => {
  beforeEach(() => {
    streamLifecycleCalls.length = 0;
    seedProfiles([profileA, profileB], { current: profileA.id });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('defaults to the current profile when no profileId prop is given (single mode)', () => {
    const spy = vi.spyOn(freshTokenModule, 'useFreshAccessToken');

    render(
      <MonitorHoverPreview monitor={monitor}>
        <div>trigger</div>
      </MonitorHoverPreview>,
    );

    expect(streamLifecycleCalls).toEqual([{ monitorId: 'mon-1', profileId: 'profile-a' }]);
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  it('streams from the owning profile when profileId is passed (All mode)', () => {
    const spy = vi.spyOn(freshTokenModule, 'useFreshAccessToken');

    render(
      <MonitorHoverPreview monitor={monitor} profileId={profileB.id}>
        <div>trigger</div>
      </MonitorHoverPreview>,
    );

    // The stream hook resolves against profile B even though the globally
    // selected profile is A.
    expect(streamLifecycleCalls).toEqual([{ monitorId: 'mon-1', profileId: 'profile-b' }]);
    expect(spy).toHaveBeenCalledWith('profile-b');
  });
});

// refs #352: the preview had no load or error handling at all, so a stream that
// never arrives left the browser's broken-image glyph sitting in the popover.
describe('MonitorHoverPreview frame gating', () => {
  beforeEach(() => {
    seedProfiles([profileA], { current: profileA.id });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
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
