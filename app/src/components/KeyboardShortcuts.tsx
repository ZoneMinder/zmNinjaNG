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
 *
 * Everything here works the same in All mode: the shortcuts are plain
 * navigation, and the numeric jump fans out over the whole profile scope,
 * landing on the owning profile's `/all/monitors/:profileId/:id` route (refs
 * #337).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useProfileScope } from '../hooks/useProfileScope';
import { useAssistantEnabled } from '../hooks/useAssistantEnabled';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { Platform } from '../lib/platform';
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
import type { ProfileId } from '../api/types';
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
  // Scope, not the current profile: every shortcut here is profile-independent
  // navigation, so they must stay live while the ALL sentinel is selected -
  // gating on `currentProfile` (null in All mode) killed all of them (refs
  // #337, audit C10). Null scope still means "no profile at all", where there
  // is nothing to navigate to.
  const scope = useProfileScope();
  const isAllMode = scope?.mode === 'all';
  // Resolved over the scope's profiles, not `scope.settings`: an aggregate's
  // own bucket never holds assistantEnabled, so reading it here made `?` fall
  // through to the help overlay inside every group (refs #337).
  const { enabled: assistantEnabled } = useAssistantEnabled();
  const isLocked = useKioskStore((state) => state.isLocked);
  const { isTvMode } = useTvMode();

  const openPalette = useCommandPaletteStore((s) => s.setOpen);
  const openAssistant = useAssistantPanelStore((s) => s.open);

  const [buffer, setBuffer] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const bufferRef = useRef('');
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Jump targets across the whole scope, in the same profile-then-server order
  // the Monitors page lists (useScopedMonitors), so a typed number resolves to
  // the monitor a user sees first (refs #337, audit C11).
  const { monitors: scopedMonitors } = useScopedMonitors({ poll: false });

  // Available monitors minus each owning profile's hidden ones. A typed number
  // is matched against the actual ZoneMinder monitor ID (not the list
  // position), so it stays stable as monitors are added or removed (refs
  // #200). Group filtering is intentionally ignored so a number maps to the
  // same monitor regardless of the active group.
  const monitors = useMemo(() => {
    const excludedByProfile = new Map<ProfileId, Set<string>>();
    return scopedMonitors.filter((m) => {
      let excluded = excludedByProfile.get(m.profileId);
      if (!excluded) {
        excluded = getExcludedMonitorIdSet(m.profileId);
        excludedByProfile.set(m.profileId, excluded);
      }
      return !excluded.has(m.item.Monitor.Id);
    });
  }, [scopedMonitors]);

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
    const monitorId = monitorIdFromBuffer(value, monitors.map((m) => m.item.Monitor.Id));
    if (monitorId === null) {
      toast.error(t('shortcuts.no_such_monitor', { n: value }));
      return;
    }
    // Two servers routinely share a monitor id, so the bare `/monitors/:id`
    // route is ambiguous in All mode (and lands with a null session there).
    // The first match in scope order owns the number - same monitor the
    // Monitors page shows first for it (refs #337).
    const owner = monitors.find((m) => m.item.Monitor.Id === monitorId);
    const path = isAllMode && owner ? `/all/monitors/${owner.profileId}/${monitorId}` : `/monitors/${monitorId}`;
    navigate(path, { state: { from: location.pathname } });
  }, [monitors, isAllMode, navigate, location.pathname, clearBuffer, t]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // TV mode hands the keys to the d-pad handler and WebView spatial nav, but
      // only on an actual TV. On desktop (browser, Electron, keyboard tablet) TV
      // mode is cosmetic, so the shortcuts stay live (refs #241).
      if (!scope || isLocked || (isTvMode && Platform.isTVDevice)) return;
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
        if (assistantEnabled) openAssistant();
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
    [scope, isLocked, isTvMode, helpOpen, navigate, commitBuffer, clearBuffer, openPalette, assistantEnabled, openAssistant]
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
