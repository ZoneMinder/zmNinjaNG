/**
 * Global keyboard shortcuts (refs #200, #246).
 *
 * Mounted once under the router. Provides single-key navigation, a numeric
 * monitor jump, Escape-to-back, and a help overlay. Inactive while typing, when
 * a modifier is held, when the kiosk is locked, or in TV mode on an actual TV
 * device (where the d-pad handler and WebView spatial nav own the keys). On
 * desktop, TV mode is cosmetic and the shortcuts stay live (refs #241).
 *
 * The `?` key is dual-purpose: it opens the floating assistant window
 * (`useAssistantPanelStore.open()`) when the on-device assistant is enabled
 * (`settings.assistantEnabled`), otherwise it falls back to the help overlay
 * below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getMonitors } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { Platform } from '../lib/platform';
import { useAuthSlice } from '../stores/auth';
import { useKioskStore } from '../stores/kioskStore';
import { useTvMode } from '../hooks/useTvMode';
import { getExcludedMonitorIdSet } from '../lib/profile/profile-settings';
import { hasOpenOverlay } from '../lib/overlay';
import { KEYBOARD_SHORTCUTS } from '../lib/zmninja-ng-constants';
import {
  NAV_SHORTCUTS,
  routeForKey,
  isTypingTarget,
  monitorIdFromBuffer,
} from '../lib/keyboard-shortcuts';
import { useCommandPaletteStore } from '../stores/commandPalette';
import { useAssistantPanelStore } from '../stores/assistantPanel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { currentProfile, settings } = useCurrentProfile();
  const isAuthenticated = useAuthSlice(currentProfile?.id ?? null).isAuthenticated;
  const isLocked = useKioskStore((state) => state.isLocked);
  const { isTvMode } = useTvMode();

  const openPalette = useCommandPaletteStore((s) => s.setOpen);
  const openAssistant = useAssistantPanelStore((s) => s.open);

  const [buffer, setBuffer] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const bufferRef = useRef('');
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: monitorsData } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(),
    enabled: !!currentProfile && isAuthenticated,
  });

  // Available monitors minus hidden ones. A typed number is matched against the
  // actual ZoneMinder monitor ID (not the list position), so it stays stable as
  // monitors are added or removed (refs #200). Group filtering is intentionally
  // ignored so a number maps to the same monitor regardless of the active group.
  const monitors = useMemo(() => {
    const all = monitorsData?.monitors || [];
    const excluded = getExcludedMonitorIdSet();
    return excluded.size ? all.filter((m) => !excluded.has(m.Monitor.Id)) : all;
  }, [monitorsData]);

  const clearBuffer = useCallback(() => {
    bufferRef.current = '';
    setBuffer('');
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
  }, []);

  const commitBuffer = useCallback(() => {
    const value = bufferRef.current;
    clearBuffer();
    if (!value) return;
    const monitorId = monitorIdFromBuffer(value, monitors.map((m) => m.Monitor.Id));
    if (monitorId === null) {
      toast.error(t('shortcuts.no_such_monitor', { n: value }));
      return;
    }
    navigate(`/monitors/${monitorId}`, { state: { from: location.pathname } });
  }, [monitors, navigate, location.pathname, clearBuffer, t]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // TV mode hands the keys to the d-pad handler and WebView spatial nav, but
      // only on an actual TV. On desktop (browser, Electron, keyboard tablet) TV
      // mode is cosmetic, so the shortcuts stay live (refs #241).
      if (!currentProfile || isLocked || (isTvMode && Platform.isTVDevice)) return;
      if (isTypingTarget(e.target)) return;

      // Numeric monitor jump: buffer digits, commit on Enter or after a pause.
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        bufferRef.current = (bufferRef.current + e.key).slice(0, KEYBOARD_SHORTCUTS.maxMonitorDigits);
        setBuffer(bufferRef.current);
        if (commitTimer.current) clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(commitBuffer, KEYBOARD_SHORTCUTS.monitorJumpCommitMs);
        return;
      }

      if (bufferRef.current) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitBuffer();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearBuffer();
        } else {
          clearBuffer();
        }
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        if (settings.assistantEnabled) openAssistant();
        else setHelpOpen((open) => !open);
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        setHelpOpen(false);
        openPalette(true);
        return;
      }

      // Shift is only used for '?'. Other shifted keys are ignored.
      if (e.shiftKey) return;

      if (e.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (hasOpenOverlay()) return; // let the open layer handle Escape
        e.preventDefault();
        navigate(-1);
        return;
      }

      const route = routeForKey(e.key);
      if (route) {
        e.preventDefault();
        navigate(route);
      }
    },
    [currentProfile, isLocked, isTvMode, helpOpen, navigate, commitBuffer, clearBuffer, openPalette, settings.assistantEnabled, openAssistant]
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
  }, []);

  return (
    <>
      {buffer && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-popover text-popover-foreground border border-border px-4 py-2 text-sm font-medium shadow-lg pointer-events-none"
          data-testid="monitor-jump-indicator"
        >
          {t('shortcuts.go_to_monitor', { n: buffer })}
        </div>
      )}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent data-testid="keyboard-shortcuts-help">
          <DialogHeader>
            <DialogTitle>{t('shortcuts.title')}</DialogTitle>
            <DialogDescription>{t('shortcuts.subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 text-sm">
            {NAV_SHORTCUTS.map((s) => (
              <ShortcutRow key={s.key} keys={s.key.toUpperCase()} label={t(s.labelKey)} />
            ))}
            <ShortcutRow keys="1–9, …" label={t('shortcuts.monitor_by_number')} />
            <ShortcutRow keys="Esc" label={t('shortcuts.back')} />
            <ShortcutRow keys="?" label={t('shortcuts.show_help')} />
            <ShortcutRow keys="/" label={t('command_palette.jump_to')} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground truncate min-w-0">{label}</span>
      <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs">
        {keys}
      </kbd>
    </div>
  );
}
