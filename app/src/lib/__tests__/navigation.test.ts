import { describe, it, expect } from 'vitest';
import { resolveLastRouteSaveTarget, resolveSwitchDestination } from '../navigation';
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

/**
 * Where a profile switch lands (refs #337).
 *
 * The app already remembers a page per profile (and per group), and reopens
 * on it at startup, but every switch hard-navigated to /monitors and threw
 * that away. Restoring it has one hazard: a saved page can name an entity
 * that only exists on the profile being left, so only section-level routes
 * come back.
 */
describe('resolveSwitchDestination', () => {
  it('returns the section the user was last on', () => {
    expect(resolveSwitchDestination('/events')).toBe('/events');
    expect(resolveSwitchDestination('/montage')).toBe('/montage');
    expect(resolveSwitchDestination('/timeline')).toBe('/timeline');
  });

  it('falls back to monitors when nothing was remembered', () => {
    expect(resolveSwitchDestination(undefined)).toBe('/monitors');
    expect(resolveSwitchDestination('')).toBe('/monitors');
  });

  // The ids belong to the profile being left: monitor 3 is a different camera
  // on the target, and /all/ deep routes name a profile that may not even be
  // in the new scope.
  it('drops a route naming an entity, in either mode', () => {
    for (const path of ['/monitors/3', '/events/91', '/all/monitors/p1/3', '/all/events/p1/91']) {
      expect(resolveSwitchDestination(path)).toBe('/monitors');
    }
  });

  // Kiosk is a locked full-screen mode, not a page: landing in it because the
  // last session ended there would strand the user right after a switch.
  it('never lands a switch in kiosk mode', () => {
    expect(resolveSwitchDestination('/kiosk')).toBe('/monitors');
  });

  it('drops a route that no longer exists', () => {
    expect(resolveSwitchDestination('/gone')).toBe('/monitors');
  });

  // '/' is the index redirect, and it redirects to lastRoute.
  it('never lands on the index redirect', () => {
    expect(resolveSwitchDestination('/')).toBe('/monitors');
  });
});
