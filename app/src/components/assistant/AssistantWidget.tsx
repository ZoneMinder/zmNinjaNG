/**
 * Floating on-device assistant window (refs #246).
 *
 * Rendered once at the app root (`components/layout/AppLayout.tsx`) so it
 * survives route navigation. `AskPanel` (the actual conversation) stays
 * mounted for the whole 'open' <-> 'minimized' cycle, toggling only a
 * `hidden` class: only `close()` unmounts it, which is the one transition
 * where AskPanel's own unmount cleanup (abort any in-flight turn, decline any
 * pending confirm) is actually wanted. Without this, minimizing mid-turn
 * (e.g. the `navigate` tool calling `useAssistantHost`'s `minimize()` while
 * `runAssistantTurn` is still awaiting a next model response) would abort a
 * turn the user never asked to cancel.
 *
 * Desktop renders a resizable floating panel: native CSS `resize` (Tailwind's
 * `resize` utility, `resize: both`) lets the user drag the corner, and a
 * `ResizeObserver` on the same element debounces the observed size into
 * `stores/assistantPanel.ts` so it survives a reload. The width/height
 * Tailwind classes below reference CSS custom properties (`var(--assistant-w/
 * h)`) rather than literal pixel values, so the store's persisted size can
 * drive them without a JS media-query hook; they are `sm:`-prefixed, so they
 * simply do not apply below that breakpoint, leaving the mobile sheet's
 * `inset-0` classes to size it to the full viewport instead.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Minus, Trash2, X } from 'lucide-react';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useAssistantStore } from '../../stores/assistant';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { ASSISTANT_PANEL } from '../../lib/zmninja-ng-constants';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { AskPanel } from './AskPanel';

export function AssistantWidget() {
  const { t } = useTranslation();
  const { currentProfile } = useCurrentProfile();
  const profileId = currentProfile?.id;

  const panelState = useAssistantPanelStore((s) => s.state);
  const open = useAssistantPanelStore((s) => s.open);
  const minimize = useAssistantPanelStore((s) => s.minimize);
  const close = useAssistantPanelStore((s) => s.close);
  const size = useAssistantPanelStore((s) => s.size);
  const setSize = useAssistantPanelStore((s) => s.setSize);

  const running = useAssistantStore((s) => s.running);
  const threadLength = useAssistantStore((s) => (profileId ? (s.threads[profileId]?.length ?? 0) : 0));
  const reset = useAssistantStore((s) => s.reset);
  const clearActivities = useAssistantStore((s) => s.clearActivities);

  const panelRef = useRef<HTMLDivElement>(null);

  // Persists a user's corner-drag on the desktop panel (rule 25/30): observes
  // the same element the CSS `resize` handle drags, debounced so the store
  // (and its localStorage write) does not churn on every intermediate frame.
  // The callback never fires while minimized/closed: a `display: none` box
  // (the `hidden` class below) generates no ResizeObserver entries.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Below the `sm` breakpoint the panel is the full-screen mobile sheet
      // (no resize handle, no persisted size): a viewport rotation there must
      // not overwrite the desktop size.
      if (window.innerWidth < ASSISTANT_PANEL.mobileBreakpointPx) return;
      const { width, height } = entry.contentRect;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSize(width, height), ASSISTANT_PANEL.resizeDebounceMs);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [setSize]);

  if (panelState === 'closed') return null;

  const handleClear = () => {
    if (!profileId) return;
    reset(profileId);
    clearActivities();
  };

  return (
    <>
      {panelState === 'minimized' && (
        <Button
          type="button"
          onClick={open}
          aria-label={t('assistant.reopen')}
          data-testid="assistant-fab"
          // bottom-20 (not bottom-4) offsets this above BackgroundTaskDrawer's
          // own bottom-4 right-4 badge (components/BackgroundTaskDrawer.tsx)
          // so the two floating triggers never overlap.
          className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
        >
          <Bot className="h-6 w-6" />
        </Button>
      )}

      <div
        ref={panelRef}
        data-testid="assistant-panel"
        style={
          {
            '--assistant-w': `${size.width}px`,
            '--assistant-h': `${size.height}px`,
          } as CSSProperties
        }
        className={cn(
          'fixed inset-0 z-50 flex flex-col overflow-hidden border bg-card shadow-xl',
          'sm:inset-auto sm:bottom-4 sm:right-4 sm:rounded-lg sm:resize',
          'sm:w-[var(--assistant-w)] sm:h-[var(--assistant-h)]',
          // Literal px values here must match ASSISTANT_PANEL's min/max*
          // fields (Tailwind's JIT scanner needs a static class string, not
          // an interpolated constant); the store's setSize() clamps to the
          // same bounds independently.
          'sm:min-w-[320px] sm:min-h-[400px] sm:max-w-[720px] sm:max-h-[960px]',
          panelState !== 'open' && 'hidden',
        )}
      >
        <div className="flex items-center gap-2 border-b py-2 pl-3 pr-2">
          <span className="flex-1 min-w-0 truncate text-sm font-medium">{t('assistant.title')}</span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClear}
              disabled={running || threadLength === 0}
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
    </>
  );
}
