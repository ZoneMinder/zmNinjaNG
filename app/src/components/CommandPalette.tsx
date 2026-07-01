/**
 * Global command palette (refs #207).
 *
 * Opened by the `/` key, the sidebar button, or the mobile-header icon (all via
 * useCommandPaletteStore). Filters pages, monitors (name/ID), and groups, and
 * navigates on Enter or tap. Coexists with the letter/digit shortcuts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Command } from 'lucide-react';
import { getMonitors } from '../api/monitors';
import { useGroups } from '../hooks/useGroups';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { getExcludedMonitorIdSet } from '../lib/profile-settings';
import { NAV_SHORTCUTS } from '../lib/keyboard-shortcuts';
import { filterCommandItems, type CommandItem } from '../lib/command-palette';
import { useCommandPaletteStore } from '../stores/commandPalette';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { cn } from '../lib/utils';

const GROUP_LABEL_KEY: Record<CommandItem['kind'], string> = {
  page: 'command_palette.group_pages',
  group: 'command_palette.group_groups',
  monitor: 'command_palette.group_monitors',
};

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { setSelectedGroup } = useGroupFilter();
  const { groups } = useGroups();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const { data: monitorsData } = useQuery({
    queryKey: ['monitors', currentProfile?.id],
    queryFn: () => getMonitors(),
    enabled: !!currentProfile && isAuthenticated,
  });

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
    const excluded = getExcludedMonitorIdSet();
    const monitorItems: CommandItem[] = (monitorsData?.monitors || [])
      .filter((m) => !excluded.has(m.Monitor.Id))
      .map((m) => ({ kind: 'monitor', id: `m-${m.Monitor.Id}`, label: m.Monitor.Name, monitorId: m.Monitor.Id }));
    return [...pages, ...groupItems, ...monitorItems];
  }, [t, groups, monitorsData]);

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

  const commit = (item: CommandItem | undefined) => {
    if (!item) return;
    setOpen(false);
    if (item.kind === 'page') {
      navigate(item.route);
    } else if (item.kind === 'monitor') {
      navigate(`/monitors/${item.monitorId}`, { state: { from: location.pathname } });
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

  // Walk the (already kind-ordered) results, emitting a header when the kind
  // changes. flatIndex tracks the active-row position across groups.
  let flatIndex = -1;
  let lastKind: CommandItem['kind'] | null = null;

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
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1" data-testid="command-palette-results">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('command_palette.empty')}
            </p>
          )}
          {results.map((item) => {
            flatIndex += 1;
            const index = flatIndex;
            const header = item.kind !== lastKind ? t(GROUP_LABEL_KEY[item.kind]) : null;
            lastKind = item.kind;
            return (
              <div key={item.id}>
                {header && (
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{header}</p>
                )}
                <button
                  type="button"
                  onClick={() => commit(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-left',
                    index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                  )}
                  data-testid={`command-item-${item.kind}-${item.kind === 'page' ? item.route : item.kind === 'monitor' ? item.monitorId : item.groupId}`}
                >
                  <span className="truncate min-w-0">{item.label}</span>
                  {item.kind === 'page' && item.hintKey && (
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {item.hintKey}
                    </kbd>
                  )}
                  {item.kind === 'monitor' && (
                    <span className="shrink-0 text-xs text-muted-foreground">{t('command_palette.monitor_id_label')} {item.monitorId}</span>
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
