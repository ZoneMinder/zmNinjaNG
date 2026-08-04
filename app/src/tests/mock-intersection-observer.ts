/**
 * IntersectionObserver test double.
 *
 * jsdom has none, and it is not in `setup.ts` on purpose: viewport gating
 * (refs #337) stands down where the API is missing, so a global stub would
 * silently switch the feature on for every suite that renders a montage.
 * Tests that want it install it themselves and deliver entries by hand -
 * nothing intersects in jsdom, since no element has a box.
 */

import { vi } from 'vitest';

export interface MockIntersectionEntry {
  target: Element;
  isIntersecting: boolean;
}

export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly targets = new Set<Element>();
  disconnectedCount = 0;
  readonly options?: IntersectionObserverInit;

  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.targets.add(el);
  }

  unobserve(el: Element) {
    this.targets.delete(el);
  }

  disconnect() {
    this.targets.clear();
    this.disconnectedCount += 1;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Deliver entries as the browser would. */
  fire(entries: MockIntersectionEntry[]) {
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver
    );
  }
}

/** Install the double and forget any observer an earlier test constructed. */
export function installMockIntersectionObserver(): void {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
}

/** The observer constructed most recently, which is the live one. */
export function latestIntersectionObserver(): MockIntersectionObserver {
  const { instances } = MockIntersectionObserver;
  return instances[instances.length - 1];
}
