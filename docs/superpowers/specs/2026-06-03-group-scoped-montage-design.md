# Group-scoped montage arrangements

## Problem

Montage layout state is stored as flat fields on `ProfileSettings`, one set per ZoneMinder
server profile. Group selection (`selectedGroupId`) only filters which monitors are visible.
Switching groups re-filters monitors but keeps the same arrangement, column count, and saved
layouts. A saved layout references specific monitor IDs, which mostly only exist within one
group, so a single per-profile layout pool does not match how the data is used.

## Goal

Re-key montage state by group within a profile. Switching groups swaps the whole arrangement
and auto-loads that group's last-used layout. A dedicated bucket holds the "no group / All
monitors" state.

## Scope

In scope:

- Live Montage page (`Montage.tsx`): working layout, named saved layouts, active layout name,
  display column count, hidden monitors, all per group.
- Event Montage (`EventMontage.tsx`, Events page montage view): column count per group, plus a
  group selector on the standalone `EventMontage.tsx` page.

Out of scope (possible follow-ups):

- UI to copy or move a saved layout between groups. In v1 you re-save a layout under a group by
  being in that group when you save.
- Per-breakpoint layouts beyond the existing `lg` usage.

## Group key

A single sentinel identifies the "no group / All monitors" bucket:

```ts
export const ALL_GROUPS_KEY = '__all__';
```

The active key is `selectedGroupId ?? ALL_GROUPS_KEY`. Group selection already persists per
profile via `selectedGroupId`, so both montage screens share the same active group.

## Data model

In `ProfileSettings`, replace the scattered flat fields with two keyed maps:

```ts
interface MontageGroupLayout {
  workingLayout: Layout[];          // was montageLayouts.lg
  savedLayouts: Array<{ name: string; layout: Layout[]; displayCols: number }>; // was montageSavedLayouts
  activeLayoutName: string | null;  // was montageActiveLayoutName
  gridCols: number;                 // was montageGridCols
  hiddenMonitorIds: string[];       // was montageHiddenMonitorIds
}

interface EventMontageGroupLayout {
  gridCols: number;                 // was eventMontageGridCols
}

// on ProfileSettings:
montageByGroup: Record<string, MontageGroupLayout>;
eventMontageByGroup: Record<string, EventMontageGroupLayout>;
```

Removed fields:

- `montageLayouts`, `montageSavedLayouts`, `montageActiveLayoutName`, `montageGridCols`,
  `montageHiddenMonitorIds` (folded into `MontageGroupLayout`).
- `montageGridRows`: always set equal to `montageGridCols` in current code. Folded away.
- `eventMontageGridCols` (folded into `EventMontageGroupLayout`).
- `eventMontageLayouts` and the `saveEventMontageLayout` store helper: declared but never read
  outside the store. Deleted, not migrated.

The event montage is a uniform card grid with no per-item positions, so the only state worth
scoping is the column count.

## Migration

Bump the zustand persist store to `version: 1` with a `migrate` function. Per profile:

- Seed `montageByGroup[ALL_GROUPS_KEY]` from the old flat fields:
  `workingLayout` from `montageLayouts.lg`, `savedLayouts` from `montageSavedLayouts`,
  `activeLayoutName` from `montageActiveLayoutName`, `gridCols` from `montageGridCols`,
  `hiddenMonitorIds` from `montageHiddenMonitorIds`.
- Seed `eventMontageByGroup[ALL_GROUPS_KEY].gridCols` from `eventMontageGridCols`.
- Drop the old keys.

Every existing saved layout and the current arrangement land in the "All monitors" bucket.
Nothing is lost. Users re-save layouts under specific groups as needed.

## Auto-load on group switch

`useMontageGrid` drives the "arrangements follow the group" behavior. Its restore effect gains
`groupKey` as a dependency. When the group changes it re-initializes from
`montageByGroup[groupKey]`:

- if the bucket has a `workingLayout` or `activeLayoutName`, load it;
- else generate a default grid for the group's monitors at the bucket's `gridCols`.

All writes (drag stop, resize stop, fill width, apply columns, load saved layout) target the
current group's bucket.

## Accessor

A `useMontageGroupState()` hook resolves the current key and returns
`{ groupKey, bucket, update(patch) }` so `Montage.tsx` and the grid hook do not each hand-roll
`settings.montageByGroup[key]` spreads. The store replaces `saveMontageLayout` with a
group-aware helper.

## Event Montage

The only persisted event-montage state is the column count, so group-scoping it means
reading/writing `eventMontageByGroup[groupKey].gridCols`. The standalone `EventMontage.tsx`
page gets a `<GroupFilterSelect />` in its toolbar. The Events page montage view already has
one. Switching groups recalls that group's column count.

## Affected files

- `src/stores/settings.ts`: model, defaults, migration, group-aware helpers.
- `src/components/montage/hooks/useMontageGrid.ts`: key by group, re-init on group change.
- `src/pages/Montage.tsx`: hidden monitors, saved layouts, active name via the bucket.
- `src/pages/EventMontage.tsx`, `src/pages/Events.tsx`: column count via the bucket; add the
  group selector to `EventMontage.tsx`.
- new `src/hooks/useMontageGroupState.ts`.

## Testing

- `src/stores/__tests__/settings.test.ts`: migration seeds the `__all__` bucket and drops old
  keys; default settings expose empty `montageByGroup`/`eventMontageByGroup`.
- `src/components/montage/hooks/__tests__/useMontageGrid.test.ts`: switching `groupKey`
  re-initializes the layout; writes land in the right bucket.
- `src/hooks/__tests__/useGroupFilter.test.ts`: unaffected, but verify interplay if touched.
- e2e: a montage scenario that selects a group, changes the arrangement, switches to another
  group and back, and confirms the first group's arrangement persists across a refresh.
- i18n: add labels only if the `EventMontage.tsx` group selector needs new strings; reuse
  existing montage keys where possible. Update en, de, es, fr, zh.

## Docs

Update the developer-guide chapter covering settings/montage to describe `montageByGroup`,
`eventMontageByGroup`, the `ALL_GROUPS_KEY` sentinel, and the group-keyed read/write pattern.
