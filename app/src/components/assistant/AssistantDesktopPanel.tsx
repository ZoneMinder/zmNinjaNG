/**
 * Desktop assistant window (refs #246).
 *
 * The floating, resizable card pinned to the viewport's bottom-right. This is
 * the shell that renders at/above the `sm` breakpoint; the mobile counterpart
 * is `AssistantMobileSheet`. Both embed the same `AskPanel` conversation body
 * and share `useAssistantChrome` for the header controls, so they differ only
 * in layout. Moved out of `AssistantWidget` unchanged when the mobile sheet was
 * added, so the widget stays a thin state switch.
 */
import { useCallback, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Trash2, X } from 'lucide-react';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { ASSISTANT, ASSISTANT_PANEL } from '../../lib/zmninja-ng-constants';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { AskPanel } from './AskPanel';
import { useAssistantChrome } from './useAssistantChrome';

export function AssistantDesktopPanel() {
  const { t } = useTranslation();
  const size = useAssistantPanelStore((s) => s.size);
  const setSize = useAssistantPanelStore((s) => s.setSize);
  const { backendLabel, clear, minimize, close, canClear } = useAssistantChrome();

  const panelRef = useRef<HTMLDivElement>(null);

  // Top-left resize: the panel is anchored bottom-right, so the free corner is
  // top-left. Deltas invert (drag LEFT or UP to enlarge). The drag drives the
  // CSS size vars live for a lag-free feel and persists the final size on
  // release.
  //
  // Deliberately NOT a ResizeObserver reading `contentRect`: the CSS vars set a
  // border-box width, `contentRect` reports the content box (2px smaller here
  // because of the panel border), so persisting it re-rendered 2px smaller each
  // cycle and the panel shrank on its own. Persisting the drag's own value on
  // release avoids that feedback entirely.
  const handleResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = panelRef.current;
      if (!el) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = el.offsetWidth;
      const startH = el.offsetHeight;
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);

      let width = startW;
      let height = startH;
      const onMove = (ev: PointerEvent) => {
        width = Math.min(ASSISTANT_PANEL.maxWidth, Math.max(ASSISTANT_PANEL.minWidth, startW - (ev.clientX - startX)));
        height = Math.min(ASSISTANT_PANEL.maxHeight, Math.max(ASSISTANT_PANEL.minHeight, startH - (ev.clientY - startY)));
        el.style.setProperty('--assistant-w', `${width}px`);
        el.style.setProperty('--assistant-h', `${height}px`);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setSize(width, height);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setSize],
  );

  return (
    <div
      ref={panelRef}
      data-testid="assistant-panel"
      style={{ '--assistant-w': `${size.width}px`, '--assistant-h': `${size.height}px` } as CSSProperties}
      className={cn(
        'fixed bottom-4 right-4 z-50 flex flex-col overflow-hidden rounded-lg border bg-card shadow-xl',
        'w-[var(--assistant-w)] h-[var(--assistant-h)]',
        // Literal px values must match ASSISTANT_PANEL's min/max* (Tailwind's
        // JIT needs a static string); setSize() clamps to the same bounds.
        'min-w-[320px] min-h-[400px] max-w-[720px] max-h-[960px]',
      )}
    >
      <div
        onPointerDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('assistant.resize')}
        data-testid="assistant-panel-resize"
        className="absolute left-0 top-0 z-10 h-5 w-5 cursor-nwse-resize"
      >
        <div className="ml-1 mt-1 h-2.5 w-2.5 rounded-tl-sm border-l-2 border-t-2 border-muted-foreground/40" />
      </div>

      <div className="flex items-center gap-2 border-b py-2 pl-3 pr-2">
        <img src={ASSISTANT.logoPath} alt={t('assistant.title')} className="h-5 w-5 shrink-0 rounded object-contain" />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium leading-tight">{t('assistant.title')}</div>
          <div
            className="truncate text-[11px] leading-tight text-muted-foreground"
            title={backendLabel}
            data-testid="assistant-backend-label"
          >
            {backendLabel}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clear}
            disabled={!canClear}
            aria-label={t('assistant.clear')}
            data-testid="assistant-clear"
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
            data-testid="assistant-minimize"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={close}
            aria-label={t('common.close')}
            data-testid="assistant-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <AskPanel />
      </div>
    </div>
  );
}
