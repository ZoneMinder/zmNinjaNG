/**
 * useAndroidBackButton decision logic tests (refs #192).
 *
 * The hook itself wires Capacitor + the DOM and needs a device; the routing and
 * branching it depends on is pure and covered here.
 */

import { describe, it, expect } from 'vitest';
import { decideBackAction, isRootRoute } from '../useAndroidBackButton';

describe('isRootRoute', () => {
  it('treats top-level menu routes as roots', () => {
    expect(isRootRoute('/monitors')).toBe(true);
    expect(isRootRoute('/events')).toBe(true);
    expect(isRootRoute('/montage')).toBe(true);
    expect(isRootRoute('/settings')).toBe(true);
  });

  it('treats detail routes as non-root', () => {
    expect(isRootRoute('/monitors/5')).toBe(false);
    expect(isRootRoute('/events/123')).toBe(false);
    expect(isRootRoute('/profiles/new')).toBe(false);
  });
});

describe('decideBackAction', () => {
  it('closes an open overlay before anything else', () => {
    expect(
      decideBackAction({ hasOpenOverlay: true, isRootRoute: true, doubleTapActive: true })
    ).toBe('close-overlay');
  });

  it('navigates back from a detail view', () => {
    expect(
      decideBackAction({ hasOpenOverlay: false, isRootRoute: false, doubleTapActive: false })
    ).toBe('navigate-back');
  });

  it('asks for exit confirmation on the first back at a root', () => {
    expect(
      decideBackAction({ hasOpenOverlay: false, isRootRoute: true, doubleTapActive: false })
    ).toBe('confirm-exit');
  });

  it('exits on a second back at a root within the window', () => {
    expect(
      decideBackAction({ hasOpenOverlay: false, isRootRoute: true, doubleTapActive: true })
    ).toBe('exit');
  });
});
