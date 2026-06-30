# Global command palette

Issue: #207 (generalizes the desktop-only keyboard shortcuts in #200 to all platforms).

## Problem

Quick navigation today is keyboard-only (`src/components/KeyboardShortcuts.tsx`): single
letters jump to sections, digits jump to a monitor. None of it works on a phone, where there is
no hardware keyboard, and there is no way to jump to a monitor by name or to a group. The
feature also has no discoverable entry point: you have to know the keys.

## Goal

One command palette that lists the places you can go (pages, monitors, groups), filters as you
type, and commits on Enter or tap. It is reachable by the `/` key on desktop/web and by a
visible button on every platform, so it works on phones too. The existing letter and digit
shortcuts stay as fast paths.

## Scope

In scope (v1):

- A `CommandPalette` dialog component with type-to-filter and keyboard + touch selection.
- Three result kinds: pages (the nav routes), monitors (by name and ID), groups (by name).
- Entry points: the `/` key (desktop/web), a sidebar "Search" item (desktop), and a search
  icon in the mobile header (touch).
- A pure, unit-tested filter/rank helper.
- i18n for all new strings (en, de, es, fr, zh). e2e coverage on web.

Out of scope (possible follow-ups):

- In-app action commands (theme toggle, profile switch, refresh, open help). The item model is
  a discriminated union so these slot in later without rework.
- Fuzzy/subsequence matching. v1 is case-insensitive substring with prefix-first ranking.
- Recent/frequent ordering and history.

## Item model

A discriminated union, memoized from the component's live query data (monitors, groups) and the
static nav routes. Defined in `src/lib/command-palette.ts`:

```ts
export type CommandItem =
  | { kind: 'page'; id: string; label: string; route: string; hintKey?: string }
  | { kind: 'monitor'; id: string; label: string; monitorId: string }
  | { kind: 'group'; id: string; label: string; groupId: string };
```

Sources:

- Pages: from `NAV_SHORTCUTS` (`src/lib/keyboard-shortcuts.ts`). `label` from the existing
  `labelKey` translation, `hintKey` is the single-letter shortcut shown as a `kbd`.
- Monitors: from `getMonitors()`, with per-profile excluded monitors removed (same list the
  digit jump uses). `label` is `Monitor.Name`; matching also tests `Monitor.Id`.
- Groups: from `useGroups()`. `label` is `Group.Name`.

## Filtering and ranking

Pure function in `src/lib/command-palette.ts`, unit-tested:

```ts
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[];
```

Rules:

- Empty query: return pages and groups only (both short). Monitors are withheld until there is
  a query, because monitor lists get long.
- Non-empty query: case-insensitive. An item matches when its label contains the query; a
  monitor also matches when its `monitorId` equals the typed digits. Prefix matches rank above
  mid-string matches. Stable order within a rank tier preserves the source order.
- Group order in the rendered list is fixed: Pages, then Groups, then Monitors. Ranking applies
  within each group.

## Component structure

`src/components/CommandPalette.tsx`, built on the existing `ui/dialog`:

- Controlled `open` state owned by a small store so any entry point can open it. A new
  `useCommandPaletteStore` (Zustand) with `open`/`setOpen`, mirroring existing UI stores. This
  avoids threading callbacks through the layout and the global key handler.
- On open: build the item list, focus the input. Input is a controlled text field.
- Render: search input pinned at the top; below it a scrollable list grouped by kind with a
  header per non-empty group; each row shows the label, a kind hint (page: its letter `kbd`;
  monitor: `id N`; group: a group icon), and a highlight for the active row.
- Keyboard: Up/Down move the active row across the flattened filtered list, Enter commits the
  active row, Escape closes (Radix Dialog handles Escape and click-outside).
- Commit by kind: page -> `navigate(route)`; monitor -> `navigate('/monitors/:id')`; group ->
  `setSelectedGroup(groupId)` then `navigate('/montage')`. Always close after commit.
- `data-testid`s: `command-palette`, `command-palette-input`, `command-item-<kind>-<id>`.

## Entry points

1. `/` key (desktop/web). Added to the `onKeyDown` handler in `KeyboardShortcuts.tsx`, before
   the `if (e.shiftKey) return;` guard and after the buffer/`?` handling: when the key is `/`
   and no monitor-jump buffer is active, `preventDefault()` and open the palette. The handler
   already bails on `isTypingTarget`, kiosk lock, and TV mode, so the palette inherits those.
2. Sidebar "Search" item (`SidebarContent.tsx`), shown with a `/` `kbd` hint. Opens the palette.
3. Mobile header search icon (`AppLayout.tsx`, the `md:hidden` header's right-side slot at the
   existing `flex items-center gap-1` group). Opens the palette. This is the touch entry point.

The `?` help dialog gains a row documenting `/`.

## Mobile behavior

- The header button is the trigger; a touchscreen has no `/` key, and the letter/digit
  shortcuts never fire without a hardware keyboard.
- Opening focuses the input to raise the on-screen keyboard. iOS WebKit only raises the keyboard
  when focus runs inside the originating tap gesture, so the focus call must be synchronous on
  open (not deferred). This path needs an on-device check before merge (AGENTS rule 27).
- On small screens the dialog anchors near the top (input pinned, results scroll below) instead
  of vertically centered, so the keyboard covering the lower half does not hide the input or the
  active row. It respects the existing safe-area insets (`--sai-top`). This is a responsive
  variant of `DialogContent`, not a new dialog.
- Selection is by tap. Up/Down/Enter still work for hardware keyboards (iPad, Android TV).

## i18n

New keys under a `command_palette` block in all five locale files: `title`, `placeholder`,
`group_pages`, `group_monitors`, `group_groups`, `empty` (no matches), and a `search` label for
the trigger buttons. Labels stay short per AGENTS rule 22.

## Testing

- Unit: `filterCommandItems` (matching, ID match for monitors, prefix-first ranking, empty-query
  withholding of monitors, grouping order).
- Component/e2e (`command-palette.feature`, web): open via `/`, type a query, see filtered
  results, Enter navigates; open via the trigger button; Escape closes. Tagged `@web` plus
  `@android` `@ios-phone` for the trigger button and touch selection.
- Manual device pass: iOS keyboard-raise on open, and the top-anchored layout above the keyboard
  on a real phone.

## Coexistence

The letter shortcuts, digit monitor-jump, Escape-to-back, and `?` help are unchanged. The
palette is an additional, discoverable, cross-platform entry point that reuses the same routes
and monitor list.
