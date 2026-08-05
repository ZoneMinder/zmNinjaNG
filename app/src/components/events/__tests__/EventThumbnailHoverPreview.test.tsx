/**
 * EventThumbnailHoverPreview owning-profile wiring (refs #337 Task 2).
 *
 * The ZMS hover-preview stream must be built against the event's OWNING
 * profile, not whichever profile is globally current - the same class of
 * bug the montage tiles and preview popover had (carried debt, Phase 3
 * re-review).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { EventZmsHoverPlayer } from '../EventThumbnailHoverPreview';

vi.mock('../../../lib/zm/zms-quit', () => ({
  sendDelayedCmdQuit: vi.fn(),
  cancelPendingQuit: vi.fn(() => false),
}));

vi.mock('../../../lib/logger', () => ({
  log: { zmsEventPlayer: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useProfileById: (profileId?: string) => ({
    profile: profileId
      ? { id: profileId, portalUrl: `https://${profileId}.test`, apiUrl: `https://${profileId}.test/api` }
      : { id: 'current-profile', portalUrl: 'https://current-profile.test', apiUrl: 'https://current-profile.test/api' },
    settings: { forceDisableMultiPort: false, hoverPreviewPlaybackRate: 1 },
  }),
}));

vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: (profileId?: string) => ({
    token: profileId ? `${profileId}-token` : 'current-profile-token',
    isFresh: true,
  }),
}));

describe('EventZmsHoverPlayer owning-profile wiring (refs #337 Task 2)', () => {
  it("streams from profile B's portal when the descriptor carries profileId B", () => {
    const { container } = render(
      <EventZmsHoverPlayer descriptor={{ eventId: 'e1', monitorId: '3', profileId: 'profile-b' }} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('profile-b.test');
    expect(img.src).not.toContain('current-profile.test');
  });

  it('falls back to the current profile when no profileId is given (single mode, byte-identical)', () => {
    const { container } = render(
      <EventZmsHoverPlayer descriptor={{ eventId: 'e1', monitorId: '3' }} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('current-profile.test');
  });
});
