import { describe, it, expect } from 'vitest';
import { resolveLastRouteSaveTarget } from '../navigation';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../api/types';

const P1 = asProfileId('p1');
const GROUP = mintVirtualProfileId();

describe('resolveLastRouteSaveTarget', () => {
  it('saves to the real profile in single mode', () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, null, P1)).toBe(P1);
  });

  // Aggregating: currentProfile is null (useCurrentProfile resolves it to null
  // for any aggregate id), so the old `currentProfile?.id` guard silently
  // dropped every route while aggregating - no page was ever remembered. This
  // is the fix: the active aggregate's own bucket. The single-mode id stays a
  // separate argument (AppLayout.tsx passes `currentProfile?.id`, undefined
  // while aggregating) so an aggregate can never fall back to it.
  it('saves to the ALL bucket in All Servers mode, never the single-mode profile id', () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, ALL_PROFILES_ID, undefined)).toBe(
      ALL_PROFILES_ID
    );
  });

  // Each group is its own aggregate with its own bucket, so it remembers its
  // own last page rather than sharing All Servers'.
  it("saves to the active group's bucket, not the ALL sentinel's", () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, GROUP, undefined)).toBe(GROUP);
  });

  it('excludes the setup/profile routes in both modes', () => {
    for (const path of ['/profiles/new', '/setup', '/profiles']) {
      expect(resolveLastRouteSaveTarget(path, false, null, P1)).toBeNull();
      expect(resolveLastRouteSaveTarget(path, false, ALL_PROFILES_ID, undefined)).toBeNull();
    }
  });

  it('excludes a notification-opened page in both modes', () => {
    expect(resolveLastRouteSaveTarget('/events/5', true, null, P1)).toBeNull();
    expect(resolveLastRouteSaveTarget('/events/5', true, ALL_PROFILES_ID, undefined)).toBeNull();
  });

  it('saves nothing when there is truly no profile selected yet', () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, null, undefined)).toBeNull();
  });
});
