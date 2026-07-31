import { describe, it, expect, vi, afterEach } from 'vitest';
import { runViewTransition } from '../view-transition';

// lib.dom types startViewTransition as always present, which is exactly the
// assumption this module exists to avoid, so the stubs go through a loose view
// of the document object.
const doc = document as unknown as Record<string, unknown>;

afterEach(() => {
  delete doc.startViewTransition;
  vi.unstubAllGlobals();
});

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

describe('runViewTransition', () => {
  it('applies the change directly when the browser has no View Transitions API', () => {
    // Electron's Chromium and some Capacitor webviews do not have it, and a
    // hard dependency there would mean the list never updates at all.
    const apply = vi.fn();
    runViewTransition(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('runs the change inside a transition when the API is available', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    doc.startViewTransition = startViewTransition;
    stubReducedMotion(false);

    const apply = vi.fn();
    runViewTransition(apply);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('skips the transition when the user asked for reduced motion', () => {
    const startViewTransition = vi.fn();
    doc.startViewTransition = startViewTransition;
    stubReducedMotion(true);

    const apply = vi.fn();
    runViewTransition(apply);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
