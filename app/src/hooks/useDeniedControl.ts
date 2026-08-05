/**
 * useDeniedControl
 *
 * Turns a control ZoneMinder will refuse into one that says so. Greying alone
 * is not enough - an absent explanation is what makes a restricted account feel
 * like a broken app - and the obvious implementation is the one that cannot
 * work: a `disabled` button dispatches no pointer events, so `useLongPressHint`
 * never fires and browsers suppress its `title` too. It would grey out and
 * explain nothing (refs #344).
 *
 * So the control stays live and loses only its action. Three ways in, all from
 * the same string: hover shows `title`, hold shows the long-press toast that
 * `Button` and `HintButton` already wire from `title`, and a tap explains
 * instead of acting - which matters most, because tapping is what a phone user
 * does first and a hold they never think to try teaches them nothing.
 *
 * `aria-disabled` rather than `disabled` also keeps the control focusable, so a
 * screen reader announces it as unavailable instead of skipping it (I3).
 */

import { useCallback, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

export interface DeniedControlOptions {
  /** True only when ZoneMinder has actually refused. Never on `unknown`. */
  denied: boolean;
  /** Why, naming the ZoneMinder permission. Shown on hover, hold, and tap. */
  message: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  title?: string;
  className?: string;
}

export interface DeniedControlProps {
  onClick: (event: MouseEvent<HTMLElement>) => void;
  title?: string;
  className?: string;
  'aria-disabled'?: true;
}

export function useDeniedControl({
  denied,
  message,
  onClick,
  title,
  className,
}: DeniedControlOptions): DeniedControlProps {
  const explain = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // Cards and rows are clickable underneath these buttons; explaining must
      // not also navigate.
      event.preventDefault();
      event.stopPropagation();
      toast(message);
    },
    [message],
  );

  if (!denied) return { onClick, title, className };

  return {
    onClick: explain,
    title: message,
    className: cn(className, 'opacity-50'),
    'aria-disabled': true,
  };
}
