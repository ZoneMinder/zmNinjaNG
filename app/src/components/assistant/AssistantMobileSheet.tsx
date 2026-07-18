/**
 * Mobile assistant bottom sheet (refs #246).
 *
 * Replaces the full-screen sheet that used to cover the app and break on
 * rotation. This sheet shares the screen: the app stays visible and usable
 * above it, and the sheet occupies a draggable slice of the bottom.
 *
 * States (all one surface at different heights, see stores/assistantPanel.ts):
 * - Slim bar: at the bar minimum, only the drag grip and the input row show.
 *   The resting "always on" form.
 * - Expanded: drag the grip up to any height between the bar and ~92% of the
 *   visible viewport. No snap points, by request.
 * - Collapsed: flick the grip down past the bar, or tap the chevron, to drop to
 *   the floating button (AssistantWidget's minimized state).
 *
 * Height is stored as a fraction of the visible viewport and turned into pixels
 * here, so a rotation keeps the same proportion instead of clipping. The input
 * is kept above the keyboard with `useKeyboardViewport`, and focusing it from
 * the bar grows the sheet so the conversation is visible while typing.
 */
import { useCallback, useRef } from 'react';
import type { CSSProperties, FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Trash2, X } from 'lucide-react';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { useKeyboardViewport } from '../../hooks/useKeyboardViewport';
import { ASSISTANT_PANEL } from '../../lib/zmninja-ng-constants';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { AskPanel } from './AskPanel';
import { OllamaStatusDot } from './OllamaStatusDot';
import { useAssistantChrome } from './useAssistantChrome';

export function AssistantMobileSheet() {
  const { t } = useTranslation();
  const fraction = useAssistantPanelStore((s) => s.sheetHeightFraction);
  const setFraction = useAssistantPanelStore((s) => s.setSheetHeightFraction);
  const { backendLabel, clear, minimize, close, canClear } = useAssistantChrome();
  const { visibleHeight, keyboardInset } = useKeyboardViewport();

  const sheetRef = useRef<HTMLDivElement>(null);
  // Live pixel height during a drag; null when resting (height comes from the
  // stored fraction). A ref, not state, avoids a re-render per pointer frame.
  const dragHeightRef = useRef<number | null>(null);

  const vh = visibleHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
  const barMin = ASSISTANT_PANEL.mobileSheetBarMinPx;
  const maxPx = Math.max(barMin, ASSISTANT_PANEL.mobileSheetMaxFraction * vh);
  const restingPx = Math.min(maxPx, Math.max(barMin, fraction * vh));

  const applyHeight = useCallback((px: number) => {
    sheetRef.current?.style.setProperty('height', `${px}px`);
  }, []);

  const handleDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = sheetRef.current?.offsetHeight || restingPx;
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        // Grip is at the top of a bottom-anchored sheet: dragging up grows it.
        // Allowed below barMin during the drag so a downward pull reads as a
        // dismiss gesture; clamped on release.
        const raw = startH - (ev.clientY - startY);
        dragHeightRef.current = raw;
        applyHeight(Math.min(maxPx, Math.max(barMin - ASSISTANT_PANEL.mobileSheetDismissPx * 1.5, raw)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const raw = dragHeightRef.current ?? startH;
        dragHeightRef.current = null;
        if (raw < barMin - ASSISTANT_PANEL.mobileSheetDismissPx) {
          minimize();
          return;
        }
        const clamped = Math.min(maxPx, Math.max(barMin, raw));
        applyHeight(clamped);
        setFraction(clamped / vh);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [applyHeight, barMin, maxPx, minimize, restingPx, setFraction, vh],
  );

  // Focusing the input from the slim bar grows the sheet so the conversation is
  // visible above the keyboard. Only when near the bar, so it never shrinks a
  // sheet the user already dragged tall.
  const handleFocusCapture = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      const el = e.target;
      const isTextField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (isTextField && restingPx <= barMin + 8) {
        setFraction(ASSISTANT_PANEL.mobileSheetFocusFraction);
      }
    },
    [barMin, restingPx, setFraction],
  );

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-label={t('assistant.title')}
      data-testid="assistant-mobile-sheet"
      onFocusCapture={handleFocusCapture}
      style={{ height: `${restingPx}px`, bottom: `${keyboardInset}px` } as CSSProperties}
      className={cn(
        'fixed inset-x-0 z-50 flex flex-col overflow-hidden rounded-t-2xl border-t bg-card shadow-xl',
        'pb-[var(--sai-bottom,env(safe-area-inset-bottom))]',
        'pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]',
      )}
    >
      <div className="relative flex h-7 shrink-0 items-center justify-center">
        {/* Full-width drag surface behind the buttons; the grip pill is its
            visible affordance. Buttons sit on top (z-10) so a tap on one never
            starts a drag. */}
        <div
          onPointerDown={handleDragStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('assistant.resize')}
          data-testid="assistant-mobile-sheet-grip"
          className="absolute inset-0 flex cursor-grab touch-none items-center justify-center"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="absolute right-1 z-10 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clear}
            disabled={!canClear}
            aria-label={t('assistant.clear')}
            data-testid="assistant-mobile-clear"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={minimize}
            aria-label={t('assistant.minimize')}
            data-testid="assistant-mobile-minimize"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={close}
            aria-label={t('common.close')}
            data-testid="assistant-mobile-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Backend label as a slim strip, so the user knows which model answers
          even without the full desktop header. */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1">
        <OllamaStatusDot />
        <div
          className="truncate text-[11px] leading-tight text-muted-foreground"
          title={backendLabel}
          data-testid="assistant-mobile-backend-label"
        >
          {backendLabel}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <AskPanel />
      </div>
    </div>
  );
}
