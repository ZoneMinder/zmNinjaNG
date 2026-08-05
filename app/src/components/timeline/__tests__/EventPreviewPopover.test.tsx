/**
 * EventPreviewPopover owning-profile wiring (refs #337 Task 2).
 *
 * In All mode the popover must resolve the OWNING profile's portal/token to
 * build its snapshot thumbnail, not the (absent or wrong) current profile -
 * same class of bug the montage tiles had (carried debt from Phase 3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { EventPreviewPopover } from '../EventPreviewPopover';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDate: () => 'date', fmtTime: () => 'time' }),
}));

// The OWNING profile (from the event's profileId prop) must be resolved, not
// whichever profile happens to be globally current.
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useProfileById: (profileId?: string) => ({
    profile: profileId
      ? { id: profileId, portalUrl: `https://${profileId}.test`, apiUrl: `https://${profileId}.test/api` }
      : { id: 'current-profile', portalUrl: 'https://current-profile.test', apiUrl: 'https://current-profile.test/api' },
    settings: {
      thumbnailFallbackChain: [{ type: 'snapshot', enabled: true }],
      forceDisableMultiPort: false,
      hoverPreview: { timeline: false },
    },
  }),
}));

vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: (profileId?: string) => ({
    token: profileId ? `${profileId}-token` : 'current-profile-token',
    isFresh: true,
  }),
}));

const getQueryDataMock = vi.fn(() => undefined);
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: getQueryDataMock }),
}));

// Off-screen image preload: jsdom never actually loads images, so stub a
// fake Image that resolves onload as soon as `src` is set.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 100;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const baseEvent = {
  id: 'e1',
  monitorId: '3',
  cause: 'Motion',
  startDateTime: '2026-01-01 00:00:00',
  duration: '10',
  alarmFrames: '1',
  notes: null,
  monitorName: 'Front Door',
};

describe('EventPreviewPopover owning-profile wiring (refs #337 Task 2)', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders profile B's thumbnail URL when the event's profileId is B, not the current profile's", async () => {
    const { container } = render(
      <EventPreviewPopover
        event={{ ...baseEvent, profileId: 'profile-b' }}
        position={{ x: 0, y: 0 }}
        onOpenEvent={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const img = container.querySelector('img') as HTMLImageElement;
    const src = decodeURIComponent(img.src);
    expect(src).toContain('https://profile-b.test');
    expect(src).not.toContain('current-profile.test');
  });

  it('falls back to the current profile when no profileId is given (single mode, byte-identical)', async () => {
    const { container } = render(
      <EventPreviewPopover
        event={{ ...baseEvent }}
        position={{ x: 0, y: 0 }}
        onOpenEvent={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const img = container.querySelector('img') as HTMLImageElement;
    expect(decodeURIComponent(img.src)).toContain('https://current-profile.test');
  });
});
