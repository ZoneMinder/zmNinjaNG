import { describe, it, expect } from 'vitest';
import { resolveLastRouteSaveTarget } from '../navigation';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';

const P1 = asProfileId('p1');

describe('resolveLastRouteSaveTarget', () => {
  it('saves to the real profile in single mode', () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, false, P1)).toBe(P1);
  });

  // All mode: currentProfile is null (useCurrentProfile resolves it to null
  // for the ALL_PROFILES_ID sentinel), so the old `currentProfile?.id` guard
  // silently dropped every route while aggregating - no page was ever
  // remembered. This is the fix: the ALL bucket, not currentProfileId
  // (which useProfileStore never reports for the app-level "current
  // profile" concept the same way in All mode - see AppLayout.tsx).
  it('saves to the ALL bucket in All mode, never the single-mode profile id', () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, true, undefined)).toBe(ALL_PROFILES_ID);
  });

  it('excludes the setup/profile routes in both modes', () => {
    for (const path of ['/profiles/new', '/setup', '/profiles']) {
      expect(resolveLastRouteSaveTarget(path, false, false, P1)).toBeNull();
      expect(resolveLastRouteSaveTarget(path, false, true, undefined)).toBeNull();
    }
  });

  it('excludes a notification-opened page in both modes', () => {
    expect(resolveLastRouteSaveTarget('/events/5', true, false, P1)).toBeNull();
    expect(resolveLastRouteSaveTarget('/events/5', true, true, undefined)).toBeNull();
  });

  it('saves nothing when there is truly no profile selected yet', () => {
    expect(resolveLastRouteSaveTarget('/live-activity', false, false, undefined)).toBeNull();
  });
});
