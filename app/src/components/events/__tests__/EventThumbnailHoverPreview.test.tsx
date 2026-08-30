/**
 * EventThumbnailHoverPreview owning-profile wiring (refs #337 Task 2).
 *
 * The ZMS hover-preview stream must be built against the event's OWNING
 * profile, not whichever profile is globally current - the same class of
 * bug the montage tiles and preview popover had (carried debt, Phase 3
 * re-review).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { EventZmsHoverPlayer } from '../EventThumbnailHoverPreview';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('../../../lib/zm/zms-quit', () => ({
  sendDelayedCmdQuit: vi.fn(),
  cancelPendingQuit: vi.fn(() => false),
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, zmsEventPlayer: vi.fn() } };
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventZmsHoverPlayer owning-profile wiring (refs #337 Task 2)', () => {
  it("streams from profile B's portal when the descriptor carries profileId B", () => {
    seedProfiles(['current-profile', 'profile-b'], { current: 'current-profile' });

    const { container } = render(
      <EventZmsHoverPlayer descriptor={{ eventId: 'e1', monitorId: '3', profileId: 'profile-b' }} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('profile-b.test');
    expect(img.src).not.toContain('current-profile.test');
  });

  it('falls back to the current profile when no profileId is given (single mode, byte-identical)', () => {
    seedProfiles(['current-profile', 'profile-b'], { current: 'current-profile' });

    const { container } = render(
      <EventZmsHoverPlayer descriptor={{ eventId: 'e1', monitorId: '3' }} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('current-profile.test');
  });
});
