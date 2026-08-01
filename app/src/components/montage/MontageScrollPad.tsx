/**
 * Montage Scroll Pad
 *
 * In edit mode every tile is a drag surface, so on a touch screen there is
 * nothing left to swipe: a drag anywhere on the grid reorders monitors instead
 * of scrolling it. With enough tiles to fill the viewport the rest of the grid
 * becomes unreachable. This pad moves the viewport without touching the
 * layout. Shown only while editing, and only when the user turns it on from
 * the toolbar (refs #321).
 */

import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import { Button } from '../ui/button';
import { MONTAGE_SCROLL_PAD } from '../../lib/zmninja-ng-constants';

/** Top to bottom, as they sit in the pad. `jump` goes to the end, not a step. */
const BUTTONS = [
  { icon: ChevronsUp, labelKey: 'montage.scroll_top', testId: 'montage-scroll-top', jump: true, direction: -1 },
  { icon: ChevronUp, labelKey: 'montage.scroll_up', testId: 'montage-scroll-up', jump: false, direction: -1 },
  { icon: ChevronDown, labelKey: 'montage.scroll_down', testId: 'montage-scroll-down', jump: false, direction: 1 },
  { icon: ChevronsDown, labelKey: 'montage.scroll_bottom', testId: 'montage-scroll-bottom', jump: true, direction: 1 },
] as const;

/**
 * The grid container declares `overflow-auto`, but its height is content-driven
 * outside fullscreen, so the element that actually scrolls is the app's `<main>`
 * further up. Which one it is depends on the layout the page is rendered in, so
 * find it rather than assume it.
 */
function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  for (let node = from; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (node.scrollHeight > node.clientHeight && (overflowY === 'auto' || overflowY === 'scroll')) {
      return node;
    }
  }
  return null;
}

interface MontageScrollPadProps {
  /**
   * The grid container. The pad scrolls it or the nearest scrolling ancestor.
   * A ref rather than the element itself: the element is only read on a tap, so
   * the pad does not need to re-render when the grid mounts.
   */
  targetRef: RefObject<HTMLElement | null>;
}

export function MontageScrollPad({ targetRef }: MontageScrollPadProps) {
  const { t } = useTranslation();

  const scrollBy = (direction: 1 | -1) => {
    const target = findScrollParent(targetRef.current);
    if (!target) return;
    target.scrollBy({
      top: direction * target.clientHeight * MONTAGE_SCROLL_PAD.stepFraction,
      behavior: 'smooth',
    });
  };

  const scrollToEnd = (direction: 1 | -1) => {
    const target = findScrollParent(targetRef.current);
    if (!target) return;
    target.scrollTo({ top: direction > 0 ? target.scrollHeight : 0, behavior: 'smooth' });
  };

  // Fixed, not absolute: the page root is as tall as the grid, so an
  // absolutely positioned pad would sit halfway down the content instead of
  // halfway down the screen, which is exactly where it is not needed.
  return (
    <div
      className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1 rounded-full bg-background/85 p-1 shadow-lg backdrop-blur-sm border"
      data-testid="montage-scroll-pad"
    >
      {BUTTONS.map(({ icon: Icon, labelKey, testId, jump, direction }) => {
        const label = t(labelKey);
        return (
          <Button
            key={testId}
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={() => (jump ? scrollToEnd(direction) : scrollBy(direction))}
            title={label}
            aria-label={label}
            data-testid={testId}
          >
            <Icon className="h-5 w-5" />
          </Button>
        );
      })}
    </div>
  );
}
