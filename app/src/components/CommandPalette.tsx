/**
 * Global command palette (refs #207, #246).
 *
 * Opened by the `/` key, the sidebar button, or the mobile-header icon (all via
 * useCommandPaletteStore). Filters pages, monitors (name/ID), and groups, and
 * navigates on Enter or tap. Coexists with the letter/digit shortcuts.
 *
 * All mode lists every profile's monitors, each row labelled with its owning
 * server and navigating to `/all/monitors/:profileId/:id`. Group entries are
 * omitted there: groups are per-server and this release has no cross-server
 * group aggregation (refs #337).
 *
 * Also doubles as one of the entry points for the on-device assistant (refs
 * #246): the "Ask" command item opens the assistant's own floating window
 * (`stores/assistantPanel.ts`, `components/assistant/AssistantWidget.tsx`)
 * and closes this palette. The assistant is no longer hosted inside this
 * component; see AssistantWidget.tsx for its conversation UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Command } from 'lucide-react';
import { useGroups } from '../hooks/useGroups';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { useProfileScope } from '../hooks/useProfileScope';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { getExcludedMonitorIdSet } from '../lib/profile/profile-settings';
import { NAV_SHORTCUTS } from '../lib/keyboard-shortcuts';
import { filterCommandItems, type CommandItem } from '../lib/command-palette';
import { useCommandPaletteStore } from '../stores/commandPalette';
import { useAssistantPanelStore } from '../stores/assistantPanel';
import type { ProfileId } from '../api/types';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { cn } from '../lib/utils';

const GROUP_LABEL_KEY: Record<CommandItem['kind'], string> = {
  page: 'command_palette.group_pages',
  group: 'command_palette.group_groups',
  monitor: 'command_palette.group_monitors',
};

// Stable ids for the ARIA combobox/listbox relationship. Only one palette is
// mounted, so a static listbox id is fine; option ids key off the flat index.
const LISTBOX_ID = 'command-palette-listbox';
const optionId = (index: number) => `command-option-${index}`;

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const openAssistant = useAssistantPanelStore((s) => s.open);
  const scope = useProfileScope();
  const isAllMode = scope?.mode === 'all';
  const settings = scope?.settings;
  const { setSelectedGroup } = useGroupFilter();
  // Groups are per-server entities with no cross-server aggregation (that is
  // the montage work's parked scope), so this list is empty in All mode - the
  // groups query is current-profile gated. Group entries are therefore simply
  // absent from the palette there rather than present and dead (refs #337,
  // audit C13).
  const { groups } = useGroups();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Monitors across the whole scope: one profile in single mode, every profile
  // in All mode, in the order the Monitors page lists them (refs #337, audit
  // C12 - the old current-profile query left the palette listing pages only).
  const { monitors: scopedMonitors } = useScopedMonitors({ poll: false });

  const items = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = NAV_SHORTCUTS.map((s) => ({
      kind: 'page',
      id: s.route,
      label: t(s.labelKey),
      route: s.route,
      hintKey: s.key,
    }));
    const groupItems: CommandItem[] = groups.map((g) => ({
      kind: 'group',
      id: `g-${g.Group.Id}`,
      label: g.Group.Name,
      groupId: g.Group.Id,
    }));
    // Exclusions are per profile, so they resolve against the OWNING profile
    // rather than one shared set.
    const excludedByProfile = new Map<ProfileId, Set<string>>();
    const monitorItems: CommandItem[] = scopedMonitors
      .filter((m) => {
        let excluded = excludedByProfile.get(m.profileId);
        if (!excluded) {
          excluded = getExcludedMonitorIdSet(m.profileId);
          excludedByProfile.set(m.profileId, excluded);
        }
        return !excluded.has(m.item.Monitor.Id);
      })
      .map((m) => ({
        kind: 'monitor',
        // Monitor ids collide across servers, so All mode keys (and labels)
        // each entry by its owner - two "3"s are two rows, not one.
        id: isAllMode ? `m-${m.profileId}-${m.item.Monitor.Id}` : `m-${m.item.Monitor.Id}`,
        label: m.item.Monitor.Name,
        monitorId: m.item.Monitor.Id,
        profileId: isAllMode ? m.profileId : undefined,
        profileName: isAllMode ? m.profileName : undefined,
      }));
    return [...pages, ...groupItems, ...monitorItems];
  }, [t, groups, scopedMonitors, isAllMode]);

  const results = useMemo(() => filterCommandItems(items, query), [items, query]);

  // Reset query/highlight each time the palette opens; focus synchronously so
  // iOS raises the keyboard (the open is driven by a tap/keypress gesture).
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  // Keep the highlighted row visible when it moves past the scrollable list's
  // edge (keyboard navigation in a long result set). No-op when already visible.
  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (item: CommandItem | undefined) => {
    if (!item) return;
    setOpen(false);
    if (item.kind === 'page') {
      navigate(item.route);
    } else if (item.kind === 'monitor') {
      // The bare route lands with a null session in All mode; the /all/ deep
      // route carries the owning profile (refs #337).
      const path = item.profileId ? `/all/monitors/${item.profileId}/${item.monitorId}` : `/monitors/${item.monitorId}`;
      navigate(path, { state: { from: location.pathname } });
    } else {
      setSelectedGroup(item.groupId);
      navigate('/montage');
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(results[activeIndex]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[10vh] translate-y-0 sm:top-1/2 sm:-translate-y-1/2 p-0 gap-0 overflow-hidden max-w-lg"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">{t('command_palette.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('command_palette.placeholder')}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Command className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('command_palette.placeholder')}
            className="w-full bg-transparent outline-none text-sm py-1"
            data-testid="command-palette-input"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1" data-testid="command-palette-results" role="listbox" id={LISTBOX_ID}>
          {settings?.assistantEnabled && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openAssistant();
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-sm text-left hover:bg-muted"
              data-testid="command-item-ask"
            >
              <span className="truncate min-w-0">{t('command_palette.ask')}</span>
              <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">?</kbd>
            </button>
          )}
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('command_palette.empty')}
            </p>
          )}
          {/* Results are already kind-ordered, so a header goes on the first
              row of each kind. The map index is the flat row position the
              keyboard navigation uses. */}
          {results.map((item, index) => {
            const header =
              item.kind !== results[index - 1]?.kind ? t(GROUP_LABEL_KEY[item.kind]) : null;
            return (
              <div key={item.id}>
                {header && (
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{header}</p>
                )}
                <button
                  type="button"
                  role="option"
                  id={optionId(index)}
                  aria-selected={index === activeIndex}
                  onClick={() => commit(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-left',
                    index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                  )}
                  data-testid={`command-item-${item.kind}-${item.kind === 'page' ? item.route : item.kind === 'monitor' ? (item.profileId ? `${item.profileId}-${item.monitorId}` : item.monitorId) : item.groupId}`}
                >
                  <span className="truncate min-w-0">{item.label}</span>
                  {item.kind === 'page' && item.hintKey && (
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {item.hintKey}
                    </kbd>
                  )}
                  {item.kind === 'monitor' && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {/* Names repeat across servers, so All mode says which one owns this row. */}
                      {item.profileName && <span className="mr-1.5">{item.profileName}</span>}
                      {t('command_palette.monitor_id_label')} {item.monitorId}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
