/**
 * Tests for ScrollPad (edit-mode grid scrolling, refs #321).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { ScrollPad } from '../scroll-pad';
import { SCROLL_PAD } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const CLIENT_HEIGHT = 500;
const SCROLL_HEIGHT = 2000;

function makeElement(clientHeight: number, scrollHeight: number, overflowY: string) {
  const element = document.createElement('div');
  element.style.overflowY = overflowY;
  Object.defineProperty(element, 'clientHeight', { value: clientHeight });
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight });
  element.scrollBy = vi.fn();
  element.scrollTo = vi.fn();
  return element;
}

/**
 * The page's real shape: the grid declares `overflow-auto` but is exactly as
 * tall as its content, and `<main>` above it is what scrolls.
 */
let scroller: HTMLDivElement;
let grid: HTMLDivElement;

beforeEach(() => {
  scroller = makeElement(CLIENT_HEIGHT, SCROLL_HEIGHT, 'auto');
  grid = makeElement(SCROLL_HEIGHT, SCROLL_HEIGHT, 'auto');
  scroller.appendChild(grid);
  document.body.appendChild(scroller);
});

function renderPad(element: HTMLElement | null = grid) {
  const ref = createRef<HTMLElement | null>() as React.RefObject<HTMLElement | null>;
  ref.current = element;
  render(<ScrollPad targetRef={ref} />);
}

describe('ScrollPad', () => {
  it('scrolls the scrolling ancestor, not the content-sized grid it is given', async () => {
    renderPad();
    await userEvent.click(screen.getByTestId('scroll-down'));

    expect(grid.scrollBy).not.toHaveBeenCalled();
    expect(scroller.scrollBy).toHaveBeenCalledWith({
      top: CLIENT_HEIGHT * SCROLL_PAD.stepFraction,
      behavior: 'smooth',
    });
  });

  it('scrolls up by the same fraction in the other direction', async () => {
    renderPad();
    await userEvent.click(screen.getByTestId('scroll-up'));

    expect(scroller.scrollBy).toHaveBeenCalledWith({
      top: -CLIENT_HEIGHT * SCROLL_PAD.stepFraction,
      behavior: 'smooth',
    });
  });

  it('jumps to the ends of the grid', async () => {
    renderPad();
    await userEvent.click(screen.getByTestId('scroll-bottom'));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' });

    await userEvent.click(screen.getByTestId('scroll-top'));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('does nothing when the grid container is not mounted', async () => {
    renderPad(null);
    await userEvent.click(screen.getByTestId('scroll-down'));

    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });
});
