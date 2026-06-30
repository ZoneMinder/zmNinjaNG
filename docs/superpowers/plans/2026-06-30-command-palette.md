# Global Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/`-and-tap command palette that filters pages, monitors (by name/ID), and groups, and navigates on Enter or tap, working on desktop, web, and phone.

**Architecture:** A pure filter helper and a discriminated-union item model in `lib/`, a tiny Zustand store for open state so any entry point can trigger it, and a `CommandPalette` dialog component mounted once next to `KeyboardShortcuts`. Three entry points feed the store: the `/` key, a sidebar button, and a mobile-header icon.

**Tech Stack:** React, TypeScript, Zustand, Radix dialog (`components/ui/dialog`), react-router, react-i18next, Vitest, Playwright (BDD).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-30-command-palette-design.md`. Issue #207 (refs #200).
- Run all `npm` commands from `app/`.
- Logging: use `log.*` helpers, never `console.*`. (No logging needed in this feature.)
- i18n: update ALL five locale files (en, de, es, fr, zh). Never hardcode user-facing strings.
- Labels/buttons must be short across languages (AGENTS rule 22).
- Add `data-testid="kebab-case-name"` to every interactive element.
- Centralized constants in `lib/zmninja-ng-constants.ts`; no ad-hoc magic numbers with meaning.
- No em-dashes and no banned superlatives in any prose/comments/docs.
- Before each commit: `npm test`, `npx tsc --noEmit`, `npm run build` must pass; e2e for UI changes.
- Revert native build-number bumps (`app/android/app/build.gradle`, iOS pbxproj) before committing; never commit them with a feature.
- Final commit uses `refs #207` (not `fixes`) until the maintainer confirms on a device.

---

### Task 1: Item model and filter helper

**Files:**
- Create: `app/src/lib/command-palette.ts`
- Test: `app/src/lib/__tests__/command-palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CommandItem = { kind: 'page'; id: string; label: string; route: string; hintKey?: string } | { kind: 'monitor'; id: string; label: string; monitorId: string } | { kind: 'group'; id: string; label: string; groupId: string }`
  - `function filterCommandItems(items: CommandItem[], query: string): CommandItem[]`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/__tests__/command-palette.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterCommandItems, type CommandItem } from '../command-palette';

const items: CommandItem[] = [
  { kind: 'page', id: 'p-montage', label: 'Montage', route: '/montage', hintKey: 'm' },
  { kind: 'page', id: 'p-monitors', label: 'Monitors', route: '/monitors', hintKey: 'v' },
  { kind: 'group', id: 'g-1', label: 'Front Cameras', groupId: '1' },
  { kind: 'monitor', id: 'm-1', label: 'Front Door', monitorId: '1' },
  { kind: 'monitor', id: 'm-12', label: 'Driveway', monitorId: '12' },
];

describe('filterCommandItems', () => {
  it('returns pages and groups (no monitors) for an empty query', () => {
    const result = filterCommandItems(items, '');
    expect(result.map((i) => i.kind)).toEqual(['page', 'page', 'group']);
  });

  it('matches monitor by name substring (case-insensitive)', () => {
    const result = filterCommandItems(items, 'front');
    // Page/group order before monitors; both "Front Cameras" and "Front Door" match.
    expect(result.map((i) => i.id)).toEqual(['g-1', 'm-1']);
  });

  it('matches a monitor by its exact ID', () => {
    const result = filterCommandItems(items, '12');
    expect(result.map((i) => i.id)).toEqual(['m-12']);
  });

  it('groups results pages, then groups, then monitors', () => {
    const result = filterCommandItems(items, 'mon'); // "Montage","Monitors" pages
    expect(result.map((i) => i.kind)).toEqual(['page', 'page']);
  });

  it('ranks prefix matches above mid-string within a kind', () => {
    const list: CommandItem[] = [
      { kind: 'monitor', id: 'a', label: 'Back Door', monitorId: '3' },
      { kind: 'monitor', id: 'b', label: 'Door Camera', monitorId: '4' },
    ];
    // "door": "Door Camera" is a prefix match, ranks first.
    expect(filterCommandItems(list, 'door').map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for a query that matches no item', () => {
    expect(filterCommandItems(items, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/command-palette.test.ts`
Expected: FAIL ("Failed to resolve import '../command-palette'").

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/command-palette.ts`:

```ts
/**
 * Command palette item model and filtering (refs #207).
 *
 * Pure data + a single filter function so the matching/ranking logic is unit
 * tested without React. The component builds CommandItem[] from live data.
 */

export type CommandItem =
  | { kind: 'page'; id: string; label: string; route: string; hintKey?: string }
  | { kind: 'monitor'; id: string; label: string; monitorId: string }
  | { kind: 'group'; id: string; label: string; groupId: string };

// Fixed render order between kinds: pages, then groups, then monitors.
const KIND_WEIGHT: Record<CommandItem['kind'], number> = { page: 0, group: 1, monitor: 2 };

/**
 * Filter and rank items for a query.
 *
 * Empty query returns pages and groups only (monitor lists get long). A
 * non-empty query is matched case-insensitively against the label, and a
 * monitor also matches when its ID equals the typed digits. Results are ordered
 * by kind (pages, groups, monitors), then prefix-before-substring, then stable
 * source order.
 */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return items.filter((it) => it.kind !== 'monitor');
  }

  const isPrefix = (it: CommandItem): boolean => {
    if (it.kind === 'monitor' && it.monitorId === q) return true;
    return it.label.toLowerCase().startsWith(q);
  };
  const isMatch = (it: CommandItem): boolean => {
    if (it.label.toLowerCase().includes(q)) return true;
    return it.kind === 'monitor' && it.monitorId === q;
  };

  return items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => isMatch(it))
    .sort((a, b) =>
      KIND_WEIGHT[a.it.kind] - KIND_WEIGHT[b.it.kind] ||
      (isPrefix(a.it) ? 0 : 1) - (isPrefix(b.it) ? 0 : 1) ||
      a.index - b.index
    )
    .map(({ it }) => it);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/command-palette.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/command-palette.ts src/lib/__tests__/command-palette.test.ts
git commit -m "feat(palette): command item model and filter helper

refs #207"
```

---

### Task 2: Open-state store

**Files:**
- Create: `app/src/stores/commandPalette.ts`
- Test: `app/src/stores/__tests__/commandPalette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useCommandPaletteStore` with state `{ open: boolean; setOpen(open: boolean): void; toggle(): void }`.

- [ ] **Step 1: Write the failing test**

Create `app/src/stores/__tests__/commandPalette.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandPaletteStore } from '../commandPalette';

describe('useCommandPaletteStore', () => {
  beforeEach(() => useCommandPaletteStore.setState({ open: false }));

  it('defaults to closed', () => {
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('setOpen sets the open flag', () => {
    useCommandPaletteStore.getState().setOpen(true);
    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it('toggle flips the open flag', () => {
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().open).toBe(true);
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/__tests__/commandPalette.test.ts`
Expected: FAIL (cannot resolve `../commandPalette`).

- [ ] **Step 3: Write the implementation**

Create `app/src/stores/commandPalette.ts`:

```ts
/**
 * Command palette open-state (refs #207).
 *
 * Ephemeral UI state in its own store so any entry point (the global key
 * handler, the sidebar button, the mobile header) can open the palette without
 * threading callbacks through the layout.
 */

import { create } from 'zustand';

interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/__tests__/commandPalette.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/stores/commandPalette.ts src/stores/__tests__/commandPalette.test.ts
git commit -m "feat(palette): open-state store

refs #207"
```

---

### Task 3: i18n strings

**Files:**
- Modify: `app/src/locales/en/translation.json`, and `de`, `es`, `fr`, `zh`.

**Interfaces:**
- Produces: a `command_palette` block with keys `title`, `placeholder`, `group_pages`, `group_groups`, `group_monitors`, `empty`, `search`.

- [ ] **Step 1: Add the block to English**

In `app/src/locales/en/translation.json`, add a sibling key to the existing `"shortcuts"` block (insert before `"shortcuts"`):

```json
  "command_palette": {
    "title": "Go to",
    "placeholder": "Search pages, monitors, groups...",
    "group_pages": "Pages",
    "group_groups": "Groups",
    "group_monitors": "Monitors",
    "empty": "No matches",
    "search": "Search"
  },
```

- [ ] **Step 2: Add the same block to the other four locales**

`de` (`app/src/locales/de/translation.json`):

```json
  "command_palette": {
    "title": "Gehe zu",
    "placeholder": "Seiten, Monitore, Gruppen suchen...",
    "group_pages": "Seiten",
    "group_groups": "Gruppen",
    "group_monitors": "Monitore",
    "empty": "Keine Treffer",
    "search": "Suchen"
  },
```

`es` (`app/src/locales/es/translation.json`):

```json
  "command_palette": {
    "title": "Ir a",
    "placeholder": "Buscar paginas, monitores, grupos...",
    "group_pages": "Paginas",
    "group_groups": "Grupos",
    "group_monitors": "Monitores",
    "empty": "Sin resultados",
    "search": "Buscar"
  },
```

`fr` (`app/src/locales/fr/translation.json`):

```json
  "command_palette": {
    "title": "Aller a",
    "placeholder": "Rechercher pages, moniteurs, groupes...",
    "group_pages": "Pages",
    "group_groups": "Groupes",
    "group_monitors": "Moniteurs",
    "empty": "Aucun resultat",
    "search": "Rechercher"
  },
```

`zh` (`app/src/locales/zh/translation.json`):

```json
  "command_palette": {
    "title": "前往",
    "placeholder": "搜索页面、监视器、分组...",
    "group_pages": "页面",
    "group_groups": "分组",
    "group_monitors": "监视器",
    "empty": "无匹配项",
    "search": "搜索"
  },
```

- [ ] **Step 3: Verify JSON validity**

Run:
```bash
cd app && for L in en de es fr zh; do node -e "JSON.parse(require('fs').readFileSync('src/locales/$L/translation.json','utf8'));console.log('$L ok')"; done
```
Expected: `en ok` ... `zh ok` (five lines, no parse errors).

- [ ] **Step 4: Commit**

```bash
cd app && git add src/locales/*/translation.json
git commit -m "i18n(palette): command palette strings

refs #207"
```

---

### Task 4: CommandPalette component and mount

**Files:**
- Create: `app/src/components/CommandPalette.tsx`
- Modify: `app/src/App.tsx:362` (mount next to `<KeyboardShortcuts />`)
- Test: `app/src/components/__tests__/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `filterCommandItems`, `CommandItem` (Task 1); `useCommandPaletteStore` (Task 2); `command_palette` i18n (Task 3); `NAV_SHORTCUTS` from `lib/keyboard-shortcuts`; `getMonitors` from `api/monitors`; `useGroups` from `hooks/useGroups`; `useGroupFilter` from `hooks/useGroupFilter`; `getExcludedMonitorIdSet` from `lib/profile-settings`.
- Produces: `<CommandPalette />` (no props); opens from `useCommandPaletteStore`.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/__tests__/CommandPalette.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';
import { useCommandPaletteStore } from '../../stores/commandPalette';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { monitors: [{ Monitor: { Id: '1', Name: 'Front Door' } }, { Monitor: { Id: '12', Name: 'Driveway' } }] },
  }),
}));
vi.mock('../../hooks/useGroups', () => ({
  useGroups: () => ({ groups: [{ Group: { Id: '1', Name: 'Front Cameras' } }] }),
}));
const setSelectedGroup = vi.fn();
vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ setSelectedGroup }),
}));
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' } }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
}));
vi.mock('../../lib/profile-settings', () => ({ getExcludedMonitorIdSet: () => new Set<string>() }));

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useCommandPaletteStore.setState({ open: true });
  });

  it('filters monitors by name and navigates on Enter', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'driveway' } });
    // First (and only) match becomes active; Enter commits.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledWith('/monitors/12', expect.anything());
  });

  it('shows pages without typing and navigates to one', () => {
    render(<CommandPalette />);
    // Montage page row is present with an empty query.
    const montage = screen.getByTestId('command-item-page-/montage');
    fireEvent.click(montage);
    expect(navigateMock).toHaveBeenCalledWith('/montage');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/CommandPalette.test.tsx`
Expected: FAIL (cannot resolve `../CommandPalette`).

- [ ] **Step 3: Write the component**

Create `app/src/components/CommandPalette.tsx`:

```tsx
/**
 * Global command palette (refs #207).
 *
 * Opened by the `/` key, the sidebar button, or the mobile-header icon (all via
 * useCommandPaletteStore). Filters pages, monitors (name/ID), and groups, and
 * navigates on Enter or tap. Coexists with the letter/digit shortcuts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
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
      navigate(`/monitors/${item.monitorId}`, { state: { from: 'command-palette' } });
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
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
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
                    <span className="shrink-0 text-xs text-muted-foreground">id {item.monitorId}</span>
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
```

Note: confirm the base `DialogContent` centering classes in `app/src/components/ui/dialog.tsx`; the `top-[10vh] translate-y-0 sm:top-1/2 sm:-translate-y-1/2` override anchors the panel near the top on phones (so the on-screen keyboard does not cover it) and centers it on `sm+`. Adjust the class names if the base uses different centering utilities.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/__tests__/CommandPalette.test.tsx`
Expected: PASS (2 tests). If the monitor row testid differs, align the test's `getByTestId` to the rendered `data-testid`.

- [ ] **Step 5: Mount the component**

In `app/src/App.tsx`, find `<KeyboardShortcuts />` (around line 362) and add the palette beside it:

```tsx
                <KeyboardShortcuts />
                <CommandPalette />
```

Add the import near the existing `KeyboardShortcuts` import at the top of `App.tsx`:

```tsx
import { CommandPalette } from './components/CommandPalette';
```

- [ ] **Step 6: Verify build and types**

Run: `npx tsc --noEmit` then `npm run build`
Expected: no type errors; build exits 0.

- [ ] **Step 7: Commit**

```bash
cd app && git checkout -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj 2>/dev/null || true
git add src/components/CommandPalette.tsx src/components/__tests__/CommandPalette.test.tsx src/App.tsx
git commit -m "feat(palette): command palette dialog, mounted globally

refs #207"
```

---

### Task 5: Entry points (key, sidebar, mobile header, help row)

**Files:**
- Modify: `app/src/components/KeyboardShortcuts.tsx` (add `/` handler; add help row)
- Modify: `app/src/components/layout/AppLayout.tsx` (mobile header icon, ~line 221 slot)
- Modify: `app/src/components/layout/SidebarContent.tsx` (sidebar Search button)

**Interfaces:**
- Consumes: `useCommandPaletteStore` (Task 2); `command_palette.search` i18n (Task 3).
- Produces: three triggers that call `useCommandPaletteStore.getState().setOpen(true)` (or the hook's `setOpen`).

- [ ] **Step 1: Add the `/` key handler in KeyboardShortcuts**

In `app/src/components/KeyboardShortcuts.tsx`, import the store at the top:

```tsx
import { useCommandPaletteStore } from '../stores/commandPalette';
```

Inside the component, read the setter:

```tsx
  const openPalette = useCommandPaletteStore((s) => s.setOpen);
```

In `onKeyDown`, after the `if (e.key === '?') { ... }` block and before `if (e.shiftKey) return;`, add:

```tsx
      if (e.key === '/') {
        e.preventDefault();
        openPalette(true);
        return;
      }
```

Add `openPalette` to the `onKeyDown` `useCallback` dependency array.

- [ ] **Step 2: Add the help row**

In the help dialog list in `KeyboardShortcuts.tsx` (where `ShortcutRow` items are rendered), add a row after the `?` row:

```tsx
            <ShortcutRow keys="/" label={t('command_palette.search')} />
```

- [ ] **Step 3: Add the mobile-header trigger**

In `app/src/components/layout/AppLayout.tsx`, inside the mobile header's right-side group (`<div className="flex items-center gap-1">`, around line 221), add a button as the first child:

```tsx
          <Button
            variant="ghost"
            size="icon"
            onClick={() => useCommandPaletteStore.getState().setOpen(true)}
            title={t('command_palette.search')}
            data-testid="command-palette-trigger-mobile"
          >
            <Search className="h-5 w-5" />
          </Button>
```

Add imports to `AppLayout.tsx` if missing:

```tsx
import { Search } from 'lucide-react';
import { useCommandPaletteStore } from '../../stores/commandPalette';
```

- [ ] **Step 4: Add the sidebar trigger**

In `app/src/components/layout/SidebarContent.tsx`, add a button at the top of the nav list (above the nav items) that opens the palette and shows a `/` hint:

```tsx
        <button
          type="button"
          onClick={() => useCommandPaletteStore.getState().setOpen(true)}
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          data-testid="command-palette-trigger-sidebar"
        >
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            {t('command_palette.search')}
          </span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">/</kbd>
        </button>
```

Add imports to `SidebarContent.tsx` if missing:

```tsx
import { Search } from 'lucide-react';
import { useCommandPaletteStore } from '../../stores/commandPalette';
```

- [ ] **Step 5: Verify build and types**

Run: `npx tsc --noEmit` then `npm run build`
Expected: no type errors; build exits 0.

- [ ] **Step 6: Commit**

```bash
cd app && git checkout -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj 2>/dev/null || true
git add src/components/KeyboardShortcuts.tsx src/components/layout/AppLayout.tsx src/components/layout/SidebarContent.tsx
git commit -m "feat(palette): open via / key, sidebar, and mobile header

refs #207"
```

---

### Task 6: e2e coverage

**Files:**
- Create: `app/tests/features/command-palette.feature`
- Create: `app/tests/steps/command-palette.steps.ts`

**Interfaces:**
- Consumes: testids `command-palette`, `command-palette-input`, `command-palette-trigger-sidebar`, `command-item-page-/montage`.

- [ ] **Step 1: Write the feature**

Create `app/tests/features/command-palette.feature`:

```gherkin
Feature: Command palette
  As a user
  I want a searchable command palette
  So that I can jump to any page or monitor quickly

  Background:
    Given I am logged into zmNinjaNg

  @web
  Scenario: Open with slash, filter, and navigate to a page
    When I navigate to the "Dashboard" page
    And I press the slash key
    Then I should see the command palette
    When I type "montage" into the command palette
    And I press Enter in the command palette
    Then I should be on the "montage" section

  @web
  Scenario: Open from the sidebar button and close with Escape
    When I navigate to the "Dashboard" page
    And I open the command palette from the sidebar
    Then I should see the command palette
    When I press Escape key
    Then the command palette should close
```

- [ ] **Step 2: Write the step definitions**

Create `app/tests/steps/command-palette.steps.ts`:

```ts
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

When('I press the slash key', async ({ page }) => {
  await page.locator('body').press('/');
});

Then('I should see the command palette', async ({ page }) => {
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: testConfig.timeouts.element });
  await expect(page.getByTestId('command-palette-input')).toBeFocused();
});

When('I type {string} into the command palette', async ({ page }, text: string) => {
  await page.getByTestId('command-palette-input').fill(text);
});

When('I press Enter in the command palette', async ({ page }) => {
  await page.getByTestId('command-palette-input').press('Enter');
});

When('I open the command palette from the sidebar', async ({ page }) => {
  await page.getByTestId('command-palette-trigger-sidebar').click();
});

Then('the command palette should close', async ({ page }) => {
  await expect(page.getByTestId('command-palette')).toBeHidden({ timeout: testConfig.timeouts.element });
});
```

Note: reuse the existing "I should be on the {string} section" and "I press Escape key" steps from `keyboard-shortcuts.steps.ts`/`navigation.steps.ts` (do not redefine them; playwright-bdd loads all step files). If "I navigate to the {string} page" is not already global, reuse the existing one from the nav steps.

- [ ] **Step 3: Run the e2e**

Run: `npm run test:e2e -- command-palette.feature`
Expected: 2 scenarios pass. If the sidebar button is not visible at the test viewport (desktop sidebar is `hidden md:flex`), the Playwright web profile uses a desktop viewport, so it is visible; if it fails, confirm the viewport in `tests/platforms.config.defaults.ts`.

- [ ] **Step 4: Commit**

```bash
cd app && git add tests/features/command-palette.feature tests/steps/command-palette.steps.ts
git commit -m "test(palette): e2e for open, filter, navigate, close

refs #207"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/user-guide/keyboard-shortcuts.md`
- Modify: `docs/developer-guide/12-shared-services-and-components.rst`

**Interfaces:** none.

- [ ] **Step 1: User guide**

In `docs/user-guide/keyboard-shortcuts.md`, add a section above "Open a monitor by number":

```markdown
## Command palette

Press `/` (desktop) or tap the search icon in the top bar (phone) to open the
command palette. Type to filter, then press `Enter` or tap a result. You can
jump to any app page, to a monitor by name or ID, or to a monitor group. On a
phone this is the quick way to navigate, since the letter keys need a hardware
keyboard.
```

- [ ] **Step 2: Developer guide**

In `docs/developer-guide/12-shared-services-and-components.rst`, add a short entry near the `KeyboardShortcuts` description:

```rst
Command Palette
~~~~~~~~~~~~~~~

``src/components/CommandPalette.tsx`` is a global palette (refs #207) opened by
the ``/`` key (via ``KeyboardShortcuts``), a sidebar button, or the mobile-header
icon, all through ``useCommandPaletteStore``. It lists pages, monitors (by name
and ID), and groups, filtered by the pure ``filterCommandItems`` helper in
``src/lib/command-palette.ts``. Selecting a page navigates to it, a monitor opens
its live view, and a group sets the group filter and opens Montage.
```

- [ ] **Step 3: Lint docs**

Run:
```bash
cd /Users/arjun/fiddle/zmNinjaNg
grep -niE "\b(comprehensive|robust|powerful|seamless|significant|critical|major|intuitive)\b" docs/user-guide/keyboard-shortcuts.md docs/developer-guide/12-shared-services-and-components.rst
grep -c "—" docs/user-guide/keyboard-shortcuts.md docs/developer-guide/12-shared-services-and-components.rst
```
Expected: no banned words; `0` em-dashes in the changed files.

- [ ] **Step 4: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg && git add docs/user-guide/keyboard-shortcuts.md docs/developer-guide/12-shared-services-and-components.rst
git commit -m "docs(palette): document the command palette

refs #207"
```

---

## Final verification (after all tasks)

- [ ] `cd app && npm test` (all unit tests pass)
- [ ] `npx tsc --noEmit` (clean)
- [ ] `npm run build` (exits 0; revert any native build-number bumps)
- [ ] `npm run test:e2e -- command-palette.feature keyboard-shortcuts.feature` (pass)
- [ ] Manual device pass (iOS + Android): `/`-less mobile trigger opens the palette, the input focuses and raises the on-screen keyboard, and the panel sits above the keyboard. This is the AGENTS rule 27 native check; do not mark #207 `fixes` until it passes.
