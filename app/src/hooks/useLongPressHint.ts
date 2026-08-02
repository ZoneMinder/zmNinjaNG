/**
 * useLongPressHint
 *
 * Icon-only buttons explain themselves through `title`, which browsers only
 * reveal on hover. A touch screen has no hover, so on phones and tablets those
 * buttons say nothing at all. This hook gives them a touch equivalent: hold the
 * button and its `title` appears as a brief toast, the same affordance Android
 * gives a view with `tooltipText`.
 *
 * The hint replaces the press rather than accompanying it. The click that would
 * normally follow the release is swallowed, so holding a button explains it
 * instead of triggering it. A short tap is left completely alone.
 *
 * Pass the props you were going to spread on the element and spread the result
 * instead; any handlers you already had are called first, then the hint's.
 *
 *   <button {...useLongPressHint({ title: t('events.delete'), onClick: remove })} />
 *
 * `Button` (`components/ui/button.tsx`) does this for you, so anything using it
 * with a `title` is already covered.
 */

import { useEffect, useRef } from 'react';
import type { MouseEventHandler, PointerEventHandler } from 'react';
import { toast } from 'sonner';
import { UI_INTERACTIONS } from '../lib/zmninja-ng-constants';

/** The props the hint reads and composes with. Everything else is untouched. */
export interface LongPressHintProps<E extends HTMLElement> {
  title?: string;
  onPointerDown?: PointerEventHandler<E>;
  onPointerMove?: PointerEventHandler<E>;
  onPointerUp?: PointerEventHandler<E>;
  onPointerCancel?: PointerEventHandler<E>;
  onClickCapture?: MouseEventHandler<E>;
}

export function useLongPressHint<E extends HTMLElement>(
  props: LongPressHintProps<E>,
): LongPressHintProps<E> {
  const timerRef = useRef<number | null>(null);
  const pressRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const firedRef = useRef(false);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // Nothing to explain, or the caller drives its own press gesture
  // (hold-to-repeat zoom and PTZ buttons), in which case a hold already means
  // something else and must keep meaning it.
  const hint = props.title;
  if (!hint || props.onPointerDown) return props;

  // Every handler below runs the caller's own handler first, so nothing the
  // element already did is delayed or dropped.
  return {
    ...props,
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse') return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      firedRef.current = false;
      pressRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        pressRef.current = null;
        toast(hint, { duration: UI_INTERACTIONS.hintDurationMs, position: 'bottom-center' });
      }, UI_INTERACTIONS.longPressMs);
    },
    onPointerMove: (event) => {
      props.onPointerMove?.(event);
      const press = pressRef.current;
      if (!press || press.id !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      // A drag is a scroll or a swipe, not a hold.
      if (dx * dx + dy * dy > UI_INTERACTIONS.moveCancelPx ** 2) {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        pressRef.current = null;
      }
    },
    onPointerUp: (event) => {
      props.onPointerUp?.(event);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pressRef.current = null;
    },
    onPointerCancel: (event) => {
      props.onPointerCancel?.(event);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pressRef.current = null;
    },
    onClickCapture: (event) => {
      props.onClickCapture?.(event);
      if (!firedRef.current) return;
      firedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
