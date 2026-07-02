import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMainScrollRestoration } from '../useMainScrollRestoration';

function makeMain(): HTMLElement {
  const el = document.createElement('main');
  el.setAttribute('data-tv-region', 'main');
  document.body.appendChild(el);
  return el;
}

describe('useMainScrollRestoration', () => {
  let main: HTMLElement;
  beforeEach(() => {
    main = makeMain();
  });
  afterEach(() => {
    main.remove();
  });

  it('restores the saved scrollTop when returning to the same history key', () => {
    const first = renderHook(({ k }) => useMainScrollRestoration(k), {
      initialProps: { k: 'entry-1' },
    });
    main.scrollTop = 250;
    first.unmount(); // saves 250 for entry-1

    main.scrollTop = 0; // navigation reset the container
    renderHook(({ k }) => useMainScrollRestoration(k), { initialProps: { k: 'entry-1' } });
    expect(main.scrollTop).toBe(250);
  });

  it('does not restore for a different history key (fresh navigation starts at top)', () => {
    const first = renderHook(({ k }) => useMainScrollRestoration(k), {
      initialProps: { k: 'entry-1b' },
    });
    main.scrollTop = 250;
    first.unmount();

    main.scrollTop = 0;
    renderHook(({ k }) => useMainScrollRestoration(k), { initialProps: { k: 'entry-2b' } });
    expect(main.scrollTop).toBe(0);
  });

  it('does nothing when no position was saved for the key', () => {
    main.scrollTop = 0;
    renderHook(({ k }) => useMainScrollRestoration(k), { initialProps: { k: 'never-saved' } });
    expect(main.scrollTop).toBe(0);
  });
});
