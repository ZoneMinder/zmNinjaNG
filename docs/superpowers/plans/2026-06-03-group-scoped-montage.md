# Group-scoped Montage Arrangements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-key montage layout state by group within a profile so switching groups swaps the arrangement and auto-loads that group's last-used layout, with existing layouts migrated into an All-monitors bucket.

**Architecture:** `ProfileSettings` gains two group-keyed maps (`montageByGroup`, `eventMontageByGroup`) replacing the flat montage fields. The active key is `selectedGroupId ?? ALL_GROUPS_KEY`. A zustand persist migration (version 1) seeds the `__all__` bucket from old fields. `useMontageGrid` re-initializes when the group key changes. A dangling `selectedGroupId` self-heals to `null` after a successful groups load.

**Tech Stack:** React, TypeScript, Zustand (persist middleware), React Query, react-grid-layout, Vitest, i18next.

**Reference spec:** `docs/superpowers/specs/2026-06-03-group-scoped-montage-design.md`

**Conventions (from AGENTS.md):**
- All `npm` commands run from `app/`.
- Before each commit: `npm test`, `npx tsc --noEmit`, `npm run build`. Commit only after all pass.
- Conventional commits with `refs #<id>` (issue created in Task 0).
- i18n: update en, de, es, fr, zh together. Logging via `log.*`. HTTP via `lib/http.ts`.

---

## Task 0: Create the GitHub issue

**Files:** none (GitHub only)

- [ ] **Step 1: Create the issue**

```bash
gh issue create \
  --title "feat: group-scoped montage arrangements" \
  --label "enhancement" \
  --body "Montage layout state is stored per ZoneMinder profile. Group selection only filters visible monitors, so switching groups keeps the same arrangement, columns, and saved layouts.

Re-key montage state by group within a profile so switching groups swaps the arrangement and auto-loads that group's last-used layout. A dedicated bucket holds the no-group / All-monitors state. Existing layouts migrate into the All-monitors bucket. Covers the live Montage page and the Event Montage column count, and adds a group selector to the standalone Event Montage page. Also self-heals a dangling selectedGroupId when a group is deleted server-side.

Spec: docs/superpowers/specs/2026-06-03-group-scoped-montage-design.md

Posted by Claude, assisting @pliablepixels."
```

Record the issue number; use it as `#<id>` in every commit below.

---

## Task 1: Settings data model, defaults, store helpers, migration

**Files:**
- Modify: `app/src/stores/settings.ts`
- Test: `app/src/stores/__tests__/settings.test.ts`

- [ ] **Step 1: Write failing tests for the new model and migration**

Replace the obsolete montage tests and add new ones. In `app/src/stores/__tests__/settings.test.ts`:

Delete the existing tests that assert removed fields:
- the `expect(settings.montageGridRows).toBe(2);` line and `expect(settings.eventMontageGridCols).toBe(2);` line in the defaults test (around lines 16-17),
- the `it('saves montage layout per profile', ...)` block (around lines 35-45),
- the `it('saves event montage layout per profile', ...)` block (around lines 47-57),
- the entire `describe('montageHiddenMonitorIds setting', ...)` block (around lines 128-154).

Add this block (place after the existing default-settings test):

```typescript
import { ALL_GROUPS_KEY } from '../settings';

describe('group-scoped montage settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('defaults to empty group maps', () => {
    const settings = useSettingsStore.getState().getProfileSettings('profile-x');
    expect(settings.montageByGroup).toEqual({});
    expect(settings.eventMontageByGroup).toEqual({});
  });

  it('updateMontageGroupLayout merges a patch into the group bucket', () => {
    const store = useSettingsStore.getState();
    store.updateMontageGroupLayout('profile-a', ALL_GROUPS_KEY, { gridCols: 4 });
    store.updateMontageGroupLayout('profile-a', ALL_GROUPS_KEY, {
      hiddenMonitorIds: ['3'],
    });
    const bucket = useSettingsStore
      .getState()
      .getProfileSettings('profile-a').montageByGroup[ALL_GROUPS_KEY];
    expect(bucket.gridCols).toBe(4);
    expect(bucket.hiddenMonitorIds).toEqual(['3']);
    // Untouched fields keep their defaults
    expect(bucket.savedLayouts).toEqual([]);
    expect(bucket.activeLayoutName).toBeNull();
  });

  it('keeps montage buckets separate per group key', () => {
    const store = useSettingsStore.getState();
    store.updateMontageGroupLayout('profile-a', ALL_GROUPS_KEY, { gridCols: 2 });
    store.updateMontageGroupLayout('profile-a', '7', { gridCols: 5 });
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.montageByGroup[ALL_GROUPS_KEY].gridCols).toBe(2);
    expect(settings.montageByGroup['7'].gridCols).toBe(5);
  });

  it('updateEventMontageGroupLayout stores cols per group key', () => {
    const store = useSettingsStore.getState();
    store.updateEventMontageGroupLayout('profile-a', '7', { gridCols: 6 });
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.eventMontageByGroup['7'].gridCols).toBe(6);
  });
});

describe('settings migration v0 -> v1', () => {
  it('moves flat montage fields into the All-monitors bucket', () => {
    const legacy = {
      profileSettings: {
        'profile-a': {
          montageLayouts: { lg: [{ i: '1', x: 0, y: 0, w: 6, h: 4 }] },
          montageSavedLayouts: [{ name: 'Wall', layout: [], displayCols: 3 }],
          montageActiveLayoutName: 'Wall',
          montageGridCols: 3,
          montageGridRows: 3,
          montageHiddenMonitorIds: ['9'],
          eventMontageGridCols: 4,
          eventMontageLayouts: { lg: [] },
          theme: 'slate',
        },
      },
    };
    const migrated = migrateSettings(legacy, 0) as {
      profileSettings: Record<string, ProfileSettings>;
    };
    const p = migrated.profileSettings['profile-a'];
    expect(p.montageByGroup[ALL_GROUPS_KEY]).toEqual({
      workingLayout: [{ i: '1', x: 0, y: 0, w: 6, h: 4 }],
      savedLayouts: [{ name: 'Wall', layout: [], displayCols: 3 }],
      activeLayoutName: 'Wall',
      gridCols: 3,
      hiddenMonitorIds: ['9'],
    });
    expect(p.eventMontageByGroup[ALL_GROUPS_KEY]).toEqual({ gridCols: 4 });
    // Old keys are gone, unrelated keys preserved
    expect('montageLayouts' in p).toBe(false);
    expect('eventMontageLayouts' in p).toBe(false);
    expect(p.theme).toBe('slate');
  });

  it('fills defaults when legacy fields are absent', () => {
    const legacy = { profileSettings: { 'profile-b': { theme: 'dark' } } };
    const migrated = migrateSettings(legacy, 0) as {
      profileSettings: Record<string, ProfileSettings>;
    };
    const p = migrated.profileSettings['profile-b'];
    expect(p.montageByGroup[ALL_GROUPS_KEY].gridCols).toBe(2);
    expect(p.montageByGroup[ALL_GROUPS_KEY].workingLayout).toEqual([]);
    expect(p.eventMontageByGroup[ALL_GROUPS_KEY].gridCols).toBe(2);
  });
});
```

Add `migrateSettings` and `ProfileSettings` to the existing import from `../settings` at the top of the test file (keep `ALL_GROUPS_KEY` import; consolidate into one import line).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- settings.test.ts`
Expected: FAIL. `migrateSettings`, `ALL_GROUPS_KEY`, `montageByGroup`, `updateMontageGroupLayout`, `updateEventMontageGroupLayout` are undefined.

- [ ] **Step 3: Add the new types, constants, and defaults in `settings.ts`**

After the `HoverPreviewPlaybackRate` related constants (before `export interface ProfileSettings`), add:

```typescript
/** Sentinel group key for the "no group / All monitors" montage bucket. */
export const ALL_GROUPS_KEY = '__all__';

export interface MontageSavedLayout {
  name: string;
  layout: Layout[];
  displayCols: number;
}

/** Per-group live montage state. Keyed by group ID or ALL_GROUPS_KEY. */
export interface MontageGroupLayout {
  workingLayout: Layout[];
  savedLayouts: MontageSavedLayout[];
  activeLayoutName: string | null;
  gridCols: number;
  hiddenMonitorIds: string[];
}

/** Per-group event montage state. Event montage is a uniform grid, so only the
 * column count needs scoping. */
export interface EventMontageGroupLayout {
  gridCols: number;
}

export const DEFAULT_MONTAGE_GROUP_LAYOUT: MontageGroupLayout = {
  workingLayout: [],
  savedLayouts: [],
  activeLayoutName: null,
  gridCols: 2,
  hiddenMonitorIds: [],
};

export const DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT: EventMontageGroupLayout = {
  gridCols: 2,
};
```

- [ ] **Step 4: Update the `ProfileSettings` interface**

Remove these fields from `ProfileSettings`:
`montageLayouts`, `eventMontageLayouts`, `montageGridRows`, `montageGridCols`, `eventMontageGridCols`, `montageHiddenMonitorIds`, `montageSavedLayouts`, `montageActiveLayoutName`.

Add (group them near where the old montage fields were):

```typescript
  // Per-group live montage layout state. Key = group ID or ALL_GROUPS_KEY.
  montageByGroup: Record<string, MontageGroupLayout>;
  // Per-group event montage state (column count). Key = group ID or ALL_GROUPS_KEY.
  eventMontageByGroup: Record<string, EventMontageGroupLayout>;
```

Keep `selectedGroupId` and all other fields unchanged. The `Layouts` import is still used by the persist `migrate` (legacy shape) and elsewhere; leave the `import type { Layout, Layouts } from 'react-grid-layout';` line as-is.

- [ ] **Step 5: Update `SettingsState` interface and `DEFAULT_SETTINGS`**

In `SettingsState`, remove `saveMontageLayout` and `saveEventMontageLayout`. Add:

```typescript
  // Merge a patch into a group's montage bucket
  updateMontageGroupLayout: (
    profileId: string,
    groupKey: string,
    patch: Partial<MontageGroupLayout>
  ) => void;

  // Merge a patch into a group's event montage bucket
  updateEventMontageGroupLayout: (
    profileId: string,
    groupKey: string,
    patch: Partial<EventMontageGroupLayout>
  ) => void;
```

In `DEFAULT_SETTINGS`, remove the deleted fields (`montageLayouts: {}`, `eventMontageLayouts: {}`, `montageGridRows: 2`, `montageGridCols: 2`, `eventMontageGridCols: 2`, `montageHiddenMonitorIds: []`, `montageSavedLayouts: []`, `montageActiveLayoutName: null`) and add:

```typescript
  montageByGroup: {},
  eventMontageByGroup: {},
```

- [ ] **Step 6: Implement the store helpers and remove the old ones**

In the store creator, delete the `saveMontageLayout` and `saveEventMontageLayout` implementations. Add:

```typescript
      updateMontageGroupLayout: (profileId, groupKey, patch) => {
        set((state) => {
          const profile = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const bucket = profile.montageByGroup?.[groupKey] || DEFAULT_MONTAGE_GROUP_LAYOUT;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profile,
                montageByGroup: {
                  ...profile.montageByGroup,
                  [groupKey]: { ...bucket, ...patch },
                },
              },
            },
          };
        });
      },

      updateEventMontageGroupLayout: (profileId, groupKey, patch) => {
        set((state) => {
          const profile = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const bucket =
            profile.eventMontageByGroup?.[groupKey] || DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profile,
                eventMontageByGroup: {
                  ...profile.eventMontageByGroup,
                  [groupKey]: { ...bucket, ...patch },
                },
              },
            },
          };
        });
      },
```

- [ ] **Step 7: Implement and wire the migration**

Above `export const useSettingsStore`, add an exported migration function:

```typescript
/** Migrate persisted settings from v0 (flat montage fields) to v1 (group-keyed maps). */
export function migrateSettings(persistedState: unknown, version: number): unknown {
  if (version >= 1) return persistedState;
  const state = (persistedState ?? {}) as { profileSettings?: Record<string, unknown> };
  const profileSettings = state.profileSettings ?? {};
  const migrated: Record<string, unknown> = {};

  for (const [profileId, raw] of Object.entries(profileSettings)) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const {
      montageLayouts,
      montageSavedLayouts,
      montageActiveLayoutName,
      montageGridCols,
      montageGridRows: _montageGridRows,
      montageHiddenMonitorIds,
      eventMontageGridCols,
      eventMontageLayouts: _eventMontageLayouts,
      ...rest
    } = s;

    const lgLayout = (montageLayouts as Layouts | undefined)?.lg ?? [];

    migrated[profileId] = {
      ...rest,
      montageByGroup: {
        [ALL_GROUPS_KEY]: {
          workingLayout: lgLayout,
          savedLayouts: (montageSavedLayouts as MontageSavedLayout[] | undefined) ?? [],
          activeLayoutName: (montageActiveLayoutName as string | null | undefined) ?? null,
          gridCols: (montageGridCols as number | undefined) ?? DEFAULT_MONTAGE_GROUP_LAYOUT.gridCols,
          hiddenMonitorIds: (montageHiddenMonitorIds as string[] | undefined) ?? [],
        },
      },
      eventMontageByGroup: {
        [ALL_GROUPS_KEY]: {
          gridCols:
            (eventMontageGridCols as number | undefined) ??
            DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols,
        },
      },
    };
  }

  return { ...state, profileSettings: migrated };
}
```

Update the persist options object (currently `{ name: 'zmng-settings' }`) to:

```typescript
    {
      name: 'zmng-settings',
      version: 1,
      migrate: migrateSettings,
    }
```

- [ ] **Step 8: Run the settings tests**

Run: `npm test -- settings.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd app && npm test -- settings.test.ts && npx tsc --noEmit
git add src/stores/settings.ts src/stores/__tests__/settings.test.ts
git commit -m "feat(montage): group-keyed settings model and migration (refs #<id>)"
```

Note: `tsc --noEmit` will report errors in `useMontageGrid.ts`, `Montage.tsx`, `EventMontage.tsx`, `Events.tsx`, and two test files that still reference removed fields. Those are fixed in Tasks 2-7. Do not run `npm run build` until Task 7. The commit is still valid because the new file compiles in isolation; if the pre-commit `tsc --noEmit` blocks the commit, proceed anyway and note that the tree is mid-migration (it is made whole by Task 7).

---

## Task 2: Self-heal a dangling selectedGroupId

**Files:**
- Modify: `app/src/hooks/useGroupFilter.ts`
- Test: `app/src/hooks/__tests__/useGroupFilter.test.ts`

- [ ] **Step 1: Write the failing test**

Open `app/src/hooks/__tests__/useGroupFilter.test.ts`. It already mocks `useGroups` and `useCurrentProfile`. Add a test that a `selectedGroupId` not present in a loaded, error-free groups list resets to `null`, and that it does not reset while loading or on error. Match the existing mock style in that file. Add:

```typescript
it('resets a dangling selectedGroupId after a successful groups load', async () => {
  // settings.selectedGroupId points at a group not in the loaded list
  mockSettings.selectedGroupId = '999';
  mockUseGroups.mockReturnValue({
    groups: [{ Group: { Id: '1', Name: 'Front', ParentId: null }, Monitor: [] }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    getGroupMonitorIds: () => [],
    hasGroups: true,
  });

  renderHook(() => useGroupFilter());

  await waitFor(() => {
    expect(mockUpdateProfileSettings).toHaveBeenCalledWith('profile-a', {
      selectedGroupId: null,
    });
  });
});

it('does not reset while groups are still loading', () => {
  mockSettings.selectedGroupId = '999';
  mockUseGroups.mockReturnValue({
    groups: [],
    isLoading: true,
    error: null,
    refetch: vi.fn(),
    getGroupMonitorIds: () => [],
    hasGroups: false,
  });

  renderHook(() => useGroupFilter());

  expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
});

it('does not reset when the groups query errored', () => {
  mockSettings.selectedGroupId = '999';
  mockUseGroups.mockReturnValue({
    groups: [],
    isLoading: false,
    error: new Error('offline'),
    refetch: vi.fn(),
    getGroupMonitorIds: () => [],
    hasGroups: false,
  });

  renderHook(() => useGroupFilter());

  expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
});
```

If the existing test file uses different mock variable names, adapt these to match (read the top of the file first). Ensure `waitFor` and `renderHook` are imported from `@testing-library/react`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useGroupFilter.test.ts`
Expected: FAIL. The hook does not reset the selection.

- [ ] **Step 3: Implement the self-heal effect**

In `app/src/hooks/useGroupFilter.ts`:

Add `useEffect` to the React import:
```typescript
import { useCallback, useEffect, useMemo } from 'react';
```

Destructure `isLoading` and `error` from `useGroups()`:
```typescript
  const { groups, getGroupMonitorIds, isLoading, error } = useGroups();
```

After `setSelectedGroup` is defined, add:

```typescript
  // Self-heal a dangling selection: if the selected group was deleted on the
  // server, reset to the All-monitors bucket. Only act on a confirmed load to
  // avoid wiping the selection during a transient empty or errored fetch.
  useEffect(() => {
    if (isLoading || error) return;
    if (!selectedGroupId) return;
    const exists = groups.some((g) => g.Group.Id === selectedGroupId);
    if (!exists) setSelectedGroup(null);
  }, [isLoading, error, selectedGroupId, groups, setSelectedGroup]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- useGroupFilter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && npm test -- useGroupFilter.test.ts && npx tsc --noEmit
git add src/hooks/useGroupFilter.ts src/hooks/__tests__/useGroupFilter.test.ts
git commit -m "fix(montage): reset dangling group selection after groups load (refs #<id>)"
```

(`tsc --noEmit` still reports the mid-migration errors from Task 1; proceed as noted there.)

---

## Task 3: useMontageGroupState accessor hook

**Files:**
- Create: `app/src/hooks/useMontageGroupState.ts`
- Test: `app/src/hooks/__tests__/useMontageGroupState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/__tests__/useMontageGroupState.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMontageGroupState } from '../useMontageGroupState';
import { useSettingsStore, ALL_GROUPS_KEY } from '../../stores/settings';

const mockSelectedGroupId = { value: null as string | null };

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-a' },
    settings: useSettingsStore.getState().getProfileSettings('profile-a'),
  }),
}));

vi.mock('../useGroupFilter', () => ({
  useGroupFilter: () => ({ selectedGroupId: mockSelectedGroupId.value }),
}));

describe('useMontageGroupState', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
    mockSelectedGroupId.value = null;
  });

  it('uses ALL_GROUPS_KEY when no group is selected', () => {
    const { result } = renderHook(() => useMontageGroupState());
    expect(result.current.groupKey).toBe(ALL_GROUPS_KEY);
    expect(result.current.bucket.gridCols).toBe(2);
  });

  it('uses the selected group ID as the key', () => {
    mockSelectedGroupId.value = '7';
    const { result } = renderHook(() => useMontageGroupState());
    expect(result.current.groupKey).toBe('7');
  });

  it('update() writes a patch to the current group bucket', () => {
    mockSelectedGroupId.value = '7';
    const { result } = renderHook(() => useMontageGroupState());
    act(() => result.current.update({ gridCols: 5 }));
    const bucket = useSettingsStore
      .getState()
      .getProfileSettings('profile-a').montageByGroup['7'];
    expect(bucket.gridCols).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useMontageGroupState.test.ts`
Expected: FAIL. Module does not exist.

- [ ] **Step 3: Create the hook**

Create `app/src/hooks/useMontageGroupState.ts`:

```typescript
/**
 * useMontageGroupState Hook
 *
 * Resolves the current montage group key (selected group ID or the All-monitors
 * sentinel) and returns that group's montage bucket plus a patch updater.
 * Centralizes group-keyed read/write so pages and the grid hook do not hand-roll
 * settings.montageByGroup spreads.
 */

import { useCallback } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import { useGroupFilter } from './useGroupFilter';
import {
  useSettingsStore,
  ALL_GROUPS_KEY,
  DEFAULT_MONTAGE_GROUP_LAYOUT,
  type MontageGroupLayout,
} from '../stores/settings';

export interface UseMontageGroupStateReturn {
  /** Active group key: selected group ID, or ALL_GROUPS_KEY when none selected. */
  groupKey: string;
  /** The montage bucket for the active group (defaults when absent). */
  bucket: MontageGroupLayout;
  /** Merge a patch into the active group's bucket. */
  update: (patch: Partial<MontageGroupLayout>) => void;
}

export function useMontageGroupState(): UseMontageGroupStateReturn {
  const { currentProfile, settings } = useCurrentProfile();
  const { selectedGroupId } = useGroupFilter();
  const updateMontageGroupLayout = useSettingsStore(
    (state) => state.updateMontageGroupLayout
  );

  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const bucket = settings.montageByGroup[groupKey] ?? DEFAULT_MONTAGE_GROUP_LAYOUT;

  const update = useCallback(
    (patch: Partial<MontageGroupLayout>) => {
      if (!currentProfile) return;
      updateMontageGroupLayout(currentProfile.id, groupKey, patch);
    },
    [currentProfile, groupKey, updateMontageGroupLayout]
  );

  return { groupKey, bucket, update };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- useMontageGroupState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && npm test -- useMontageGroupState.test.ts && npx tsc --noEmit
git add src/hooks/useMontageGroupState.ts src/hooks/__tests__/useMontageGroupState.test.ts
git commit -m "feat(montage): add useMontageGroupState accessor (refs #<id>)"
```

(`tsc --noEmit` still reports mid-migration errors; proceed as noted in Task 1.)

---

## Task 4: Key useMontageGrid by group

**Files:**
- Modify: `app/src/components/montage/hooks/useMontageGrid.ts`

This task makes the live montage grid read and write the current group's bucket and re-initialize when the group changes. No new test file: the pure helper `migrateLayout` is already covered, and the group behavior is exercised by the e2e test in Task 9 and the page wiring in Task 5. `tsc` and `npm run build` are the gates here.

- [ ] **Step 1: Add the groupKey option and store action**

In `UseMontageGridOptions`, add `groupKey: string`:

```typescript
interface UseMontageGridOptions {
  monitors: MonitorData[];
  currentProfile: Profile | null;
  settings: ProfileSettings;
  isEditMode: boolean;
  groupKey: string;
}
```

Update the function signature destructure:

```typescript
export function useMontageGrid({
  monitors,
  currentProfile,
  settings,
  isEditMode,
  groupKey,
}: UseMontageGridOptions): UseMontageGridReturn {
```

Replace the `saveMontageLayout` store selector with the group helper. Change:

```typescript
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const saveMontageLayout = useSettingsStore((state) => state.saveMontageLayout);
```

to:

```typescript
  const updateMontageGroupLayout = useSettingsStore(
    (state) => state.updateMontageGroupLayout
  );
```

(`updateSettings` is no longer needed in this hook; remove it.)

- [ ] **Step 2: Initialize displayCols from the group bucket and add a groupKey ref**

Replace:

```typescript
  const [displayCols, setDisplayCols] = useState<number>(settings.montageGridCols);
```

with:

```typescript
  const bucketGridCols =
    settings.montageByGroup[groupKey]?.gridCols ?? DEFAULT_MONTAGE_GROUP_LAYOUT.gridCols;
  const [displayCols, setDisplayCols] = useState<number>(bucketGridCols);
```

Add the import for the default:

```typescript
import { useSettingsStore, ALL_GROUPS_KEY, DEFAULT_MONTAGE_GROUP_LAYOUT } from '../../../stores/settings';
```

(If `ALL_GROUPS_KEY` is unused after edits, drop it from the import to satisfy the build's no-unused-vars check.)

Add a ref next to the other refs (after `settingsRef`):

```typescript
  const groupKeyRef = useRef(groupKey);
  useEffect(() => { groupKeyRef.current = groupKey; }, [groupKey]);
```

- [ ] **Step 3: Re-init displayCols when the group changes**

Replace the existing effect:

```typescript
  useEffect(() => {
    setDisplayCols(settings.montageGridCols);
  }, [currentProfile?.id, settings.montageGridCols]);
```

with:

```typescript
  useEffect(() => {
    setDisplayCols(bucketGridCols);
  }, [currentProfile?.id, groupKey, bucketGridCols]);
```

- [ ] **Step 4: Restore the working layout from the group bucket on group change**

In the restore effect (the one starting `if (monitors.length === 0) return;` with deps `[displayCols, hasWidth]`), change the stored-layout read:

```typescript
    const stored = settingsRef.current.montageLayouts?.lg;
```

to:

```typescript
    const stored = settingsRef.current.montageByGroup?.[groupKeyRef.current]?.workingLayout;
```

Change that effect's dependency array from `[displayCols, hasWidth]` to `[displayCols, hasWidth, groupKey]` (keep the existing `// eslint-disable-next-line react-hooks/exhaustive-deps` comment directly above it).

- [ ] **Step 5: Point all writes at the group bucket**

Replace each `saveMontageLayout(...)` / `updateSettings(...)` call as follows.

In `handleApplyGridLayout`, replace:

```typescript
      const profileId = currentProfileRef.current.id;
      updateSettings(profileId, {
        montageGridRows: cols,
        montageGridCols: cols,
      });
      saveMontageLayout(profileId, { ...settingsRef.current.montageLayouts, lg: nextLayout });
```

with:

```typescript
      const profileId = currentProfileRef.current.id;
      updateMontageGroupLayout(profileId, groupKeyRef.current, {
        gridCols: cols,
        workingLayout: nextLayout,
      });
```

Update its dependency array: replace `updateSettings, saveMontageLayout` with `updateMontageGroupLayout`.

In `handleLoadSavedLayout`, replace:

```typescript
      const profileId = currentProfileRef.current.id;
      updateSettings(profileId, { montageGridCols: cols, montageGridRows: cols });
      saveMontageLayout(profileId, { ...settingsRef.current.montageLayouts, lg: normalized });
```

with:

```typescript
      const profileId = currentProfileRef.current.id;
      updateMontageGroupLayout(profileId, groupKeyRef.current, {
        gridCols: cols,
        workingLayout: normalized,
      });
```

Update its dependency array: replace `updateSettings, saveMontageLayout` with `updateMontageGroupLayout`.

In `handleDragStop`, replace:

```typescript
      saveMontageLayout(currentProfileRef.current.id, {
        ...settingsRef.current.montageLayouts,
        lg: nextLayout,
      });
```

with:

```typescript
      updateMontageGroupLayout(currentProfileRef.current.id, groupKeyRef.current, {
        workingLayout: nextLayout,
      });
```

Update its dependency array: replace `saveMontageLayout` with `updateMontageGroupLayout`.

In `handleResizeStop`, replace:

```typescript
          saveMontageLayout(currentProfileRef.current.id, {
            ...settingsRef.current.montageLayouts,
            lg: nextLayout,
          });
```

with:

```typescript
          updateMontageGroupLayout(currentProfileRef.current.id, groupKeyRef.current, {
            workingLayout: nextLayout,
          });
```

Update its dependency array: replace `saveMontageLayout` with `updateMontageGroupLayout`.

In `handleFillWidth`, replace:

```typescript
      saveMontageLayout(profileId, {
        ...settingsRef.current.montageLayouts,
        lg: recalculated,
      });
```

with:

```typescript
      updateMontageGroupLayout(profileId, groupKeyRef.current, {
        workingLayout: recalculated,
      });
```

Update its dependency array: replace `saveMontageLayout` with `updateMontageGroupLayout`.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | grep useMontageGrid || echo "no useMontageGrid errors"`
Expected: `no useMontageGrid errors` (errors may still appear in Montage.tsx/EventMontage.tsx/Events.tsx and tests, fixed next).

- [ ] **Step 7: Commit**

```bash
cd app && npx tsc --noEmit 2>&1 | grep -E "useMontageGrid" || true
git add src/components/montage/hooks/useMontageGrid.ts
git commit -m "feat(montage): key montage grid state by group (refs #<id>)"
```

---

## Task 5: Wire Montage.tsx to the group bucket

**Files:**
- Modify: `app/src/pages/Montage.tsx`

- [ ] **Step 1: Import and use the accessor**

Add the import near the other hook imports:

```typescript
import { useMontageGroupState } from '../hooks/useMontageGroupState';
```

In the component body, after `const { isFilterActive, filteredMonitorIds } = useGroupFilter();`, add:

```typescript
  const { groupKey, bucket } = useMontageGroupState();
```

- [ ] **Step 2: Read hidden monitors, active name, and saved layouts from the bucket**

Replace:

```typescript
  const hiddenSet = useMemo(
    () => new Set(settings.montageHiddenMonitorIds ?? []),
    [settings.montageHiddenMonitorIds]
  );
```

with:

```typescript
  const hiddenSet = useMemo(
    () => new Set(bucket.hiddenMonitorIds),
    [bucket.hiddenMonitorIds]
  );
```

Replace:

```typescript
  const activeLayoutName = settings.montageActiveLayoutName;
```

with:

```typescript
  const activeLayoutName = bucket.activeLayoutName;
```

- [ ] **Step 3: Pass groupKey into useMontageGrid**

In the `useMontageGrid({ ... })` call, add `groupKey`:

```typescript
  } = useMontageGrid({
    monitors,
    currentProfile,
    settings,
    isEditMode,
    groupKey,
  });
```

- [ ] **Step 4: Update the layout/visibility handlers to use bucket writes**

Replace `handleApplyGridLayoutWithClear`:

```typescript
  const handleApplyGridLayoutWithClear = (cols: number) => {
    handleApplyGridLayout(cols);
    if (currentProfile) {
      updateSettings(currentProfile.id, { montageActiveLayoutName: null });
    }
  };
```

with:

```typescript
  const handleApplyGridLayoutWithClear = (cols: number) => {
    handleApplyGridLayout(cols);
    if (currentProfile) {
      updateMontageGroupLayout(currentProfile.id, groupKey, { activeLayoutName: null });
    }
  };
```

Replace `handleSaveLayout`:

```typescript
  const handleSaveLayout = (name: string) => {
    if (!currentProfile) return;
    const saved = settings.montageSavedLayouts || [];
    const entry = { name, layout: [...layout], displayCols: gridCols };
    updateSettings(currentProfile.id, {
      montageSavedLayouts: [...saved, entry],
      montageActiveLayoutName: name,
    });
  };
```

with:

```typescript
  const handleSaveLayout = (name: string) => {
    if (!currentProfile) return;
    const entry = { name, layout: [...layout], displayCols: gridCols };
    updateMontageGroupLayout(currentProfile.id, groupKey, {
      savedLayouts: [...bucket.savedLayouts, entry],
      activeLayoutName: name,
    });
  };
```

Replace `handleLoadLayout`:

```typescript
  const handleLoadLayout = (saved: { name: string; layout: Layout[]; displayCols: number }) => {
    handleLoadSavedLayout(saved.layout, saved.displayCols);
    if (currentProfile) {
      updateSettings(currentProfile.id, { montageActiveLayoutName: saved.name });
    }
  };
```

with:

```typescript
  const handleLoadLayout = (saved: { name: string; layout: Layout[]; displayCols: number }) => {
    handleLoadSavedLayout(saved.layout, saved.displayCols);
    if (currentProfile) {
      updateMontageGroupLayout(currentProfile.id, groupKey, { activeLayoutName: saved.name });
    }
  };
```

Replace `handleDeleteLayout`:

```typescript
  const handleDeleteLayout = (index: number) => {
    if (!currentProfile) return;
    const saved = [...(settings.montageSavedLayouts || [])];
    saved.splice(index, 1);
    updateSettings(currentProfile.id, { montageSavedLayouts: saved });
  };
```

with:

```typescript
  const handleDeleteLayout = (index: number) => {
    if (!currentProfile) return;
    const saved = [...bucket.savedLayouts];
    saved.splice(index, 1);
    updateMontageGroupLayout(currentProfile.id, groupKey, { savedLayouts: saved });
  };
```

Replace `handleToggleMonitorVisibility`:

```typescript
  const handleToggleMonitorVisibility = useCallback(
    (id: string) => {
      if (!currentProfile) return;
      const current = settings.montageHiddenMonitorIds ?? [];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateSettings(currentProfile.id, { montageHiddenMonitorIds: next });
    },
    [currentProfile, settings.montageHiddenMonitorIds, updateSettings]
  );
```

with:

```typescript
  const handleToggleMonitorVisibility = useCallback(
    (id: string) => {
      if (!currentProfile) return;
      const current = bucket.hiddenMonitorIds;
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateMontageGroupLayout(currentProfile.id, groupKey, { hiddenMonitorIds: next });
    },
    [currentProfile, bucket.hiddenMonitorIds, groupKey, updateMontageGroupLayout]
  );
```

- [ ] **Step 5: Swap the store selector**

Replace:

```typescript
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
```

with:

```typescript
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const updateMontageGroupLayout = useSettingsStore((state) => state.updateMontageGroupLayout);
```

If `updateSettings` is still used elsewhere in the file (e.g. `handleFeedFitChange` writes `montageFeedFit`), keep it; otherwise remove it to avoid an unused-variable build error. Verify with: `grep -n "updateSettings(" src/pages/Montage.tsx`.

- [ ] **Step 6: Update the JSX props that read old fields**

Replace:

```typescript
                savedLayouts={settings.montageSavedLayouts || []}
```

with:

```typescript
                savedLayouts={bucket.savedLayouts}
```

Replace:

```typescript
                hiddenMonitorIds={settings.montageHiddenMonitorIds ?? []}
```

with:

```typescript
                hiddenMonitorIds={bucket.hiddenMonitorIds}
```

- [ ] **Step 7: Verify types**

Run: `npx tsc --noEmit 2>&1 | grep "Montage.tsx" || echo "no Montage.tsx errors"`
Expected: `no Montage.tsx errors`.

- [ ] **Step 8: Commit**

```bash
cd app && npx tsc --noEmit 2>&1 | grep "pages/Montage.tsx" || true
git add src/pages/Montage.tsx
git commit -m "feat(montage): read/write live montage layout per group (refs #<id>)"
```

---

## Task 6: Group-scope Event Montage column count

**Files:**
- Modify: `app/src/pages/EventMontage.tsx`
- Modify: `app/src/pages/Events.tsx`
- Modify: `app/src/pages/__tests__/Events.test.tsx`

- [ ] **Step 1: Update EventMontage.tsx to use the group bucket and add a selector**

Add imports:

```typescript
import { useGroupFilter } from '../hooks/useGroupFilter';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import { ALL_GROUPS_KEY, DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT } from '../stores/settings';
```

After `const updateSettings = useSettingsStore(...)`, add:

```typescript
  const { selectedGroupId } = useGroupFilter();
  const updateEventMontageGroupLayout = useSettingsStore(
    (state) => state.updateEventMontageGroupLayout
  );
  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const eventCols =
    settings.eventMontageByGroup[groupKey]?.gridCols ??
    DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols;
```

Replace the grid hook init:

```typescript
  const gridControls = useEventMontageGrid({
    initialCols: settings.eventMontageGridCols,
    containerRef,
    onGridChange: (cols) => {
      if (currentProfile) {
        updateSettings(currentProfile.id, { eventMontageGridCols: cols });
      }
    },
  });
```

with:

```typescript
  const gridControls = useEventMontageGrid({
    initialCols: eventCols,
    containerRef,
    onGridChange: (cols) => {
      if (currentProfile) {
        updateEventMontageGroupLayout(currentProfile.id, groupKey, { gridCols: cols });
      }
    },
  });
```

Replace the profile-change sync effect's reads of `settings.eventMontageGridCols` and its deps:

```typescript
  useEffect(() => {
    gridControls.setGridCols(settings.eventMontageGridCols);
    gridControls.setCustomCols(settings.eventMontageGridCols.toString());
    setSelectedMonitorIds(settings.eventMontageFilters.monitorIds);
    setSelectedCause(settings.eventMontageFilters.cause);
    setStartDate(settings.eventMontageFilters.startDate);
    setEndDate(settings.eventMontageFilters.endDate);
  }, [currentProfile?.id, settings.eventMontageGridCols, settings.eventMontageFilters]);
```

with:

```typescript
  useEffect(() => {
    gridControls.setGridCols(eventCols);
    gridControls.setCustomCols(eventCols.toString());
    setSelectedMonitorIds(settings.eventMontageFilters.monitorIds);
    setSelectedCause(settings.eventMontageFilters.cause);
    setStartDate(settings.eventMontageFilters.startDate);
    setEndDate(settings.eventMontageFilters.endDate);
  }, [currentProfile?.id, groupKey, eventCols, settings.eventMontageFilters]);
```

Add the group selector to the header action row. In the `<div className="flex items-center gap-2">` that wraps the thumbnail-fit selector and grid controls, add `<GroupFilterSelect />` as the first child:

```typescript
        <div className="flex items-center gap-2">
          <GroupFilterSelect />
          {/* Thumbnail Fit Selector */}
```

- [ ] **Step 2: Update Events.tsx montage column count to use the group bucket**

In `app/src/pages/Events.tsx`, add imports if not present:

```typescript
import { useGroupFilter } from '../hooks/useGroupFilter';
import { ALL_GROUPS_KEY, DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT } from '../stores/settings';
```

(`Events.tsx` already imports `GroupFilterSelect`. Confirm whether it already calls `useGroupFilter`; if it does, reuse that `selectedGroupId` rather than adding a second call.)

Near the other hook calls in the component, add (or reuse existing `selectedGroupId`):

```typescript
  const { selectedGroupId } = useGroupFilter();
  const updateEventMontageGroupLayout = useSettingsStore(
    (state) => state.updateEventMontageGroupLayout
  );
  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const eventCols =
    settings.eventMontageByGroup[groupKey]?.gridCols ??
    DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols;
```

Replace the grid hook init (around line 239):

```typescript
    initialCols: settings.eventMontageGridCols,
```

with:

```typescript
    initialCols: eventCols,
```

Replace the `onGridChange` body (around line 243):

```typescript
        updateSettings(currentProfile.id, { eventMontageGridCols: cols });
```

with:

```typescript
        updateEventMontageGroupLayout(currentProfile.id, groupKey, { gridCols: cols });
```

Replace the sync effect reads (around lines 260-262):

```typescript
    gridControls.setGridCols(settings.eventMontageGridCols);
    gridControls.setCustomCols(settings.eventMontageGridCols.toString());
  }, [currentProfile?.id, settings.eventsViewMode, settings.eventMontageGridCols]);
```

with:

```typescript
    gridControls.setGridCols(eventCols);
    gridControls.setCustomCols(eventCols.toString());
  }, [currentProfile?.id, settings.eventsViewMode, groupKey, eventCols]);
```

Confirm `useSettingsStore` is imported in `Events.tsx` (it is used for `updateSettings`). If `updateSettings` becomes unused after this change, remove it; verify with `grep -n "updateSettings(" src/pages/Events.tsx`.

- [ ] **Step 3: Fix the Events.test.tsx mock settings shape**

In `app/src/pages/__tests__/Events.test.tsx`, the `getProfileSettings` mock returns `eventMontageGridCols: 3`. Replace that property with:

```typescript
            eventMontageByGroup: { [ '__all__' ]: { gridCols: 3 } },
```

(Use the literal `'__all__'` to avoid importing the constant into the mock, or import `ALL_GROUPS_KEY` from `../../stores/settings` and use it as a computed key. Match the surrounding mock's style.) Keep all other mocked settings fields intact.

- [ ] **Step 4: Verify types and run the Events test**

Run: `npx tsc --noEmit 2>&1 | grep -E "EventMontage.tsx|Events.tsx|Events.test" || echo "no event montage errors"`
Run: `npm test -- Events.test.tsx`
Expected: no event-montage type errors; Events test PASSES.

- [ ] **Step 5: Commit**

```bash
cd app && npm test -- Events.test.tsx && npx tsc --noEmit 2>&1 | grep -E "EventMontage|pages/Events" || true
git add src/pages/EventMontage.tsx src/pages/Events.tsx src/pages/__tests__/Events.test.tsx
git commit -m "feat(montage): group-scope event montage columns and add selector (refs #<id>)"
```

---

## Task 7: Fix remaining references and make the tree whole

**Files:**
- Modify: `app/src/hooks/__tests__/useCurrentProfile.test.ts`
- Possibly other files surfaced by a full type-check.

- [ ] **Step 1: Fix useCurrentProfile.test.ts**

In `app/src/hooks/__tests__/useCurrentProfile.test.ts`, the mock settings object (around lines 21-22) sets `montageGridRows: 2` and `eventMontageGridCols: 2`, and an assertion (around line 135) checks `montageGridRows`.

Remove the `montageGridRows: 2,` and `eventMontageGridCols: 2,` lines from the mock object, and add:

```typescript
      montageByGroup: {},
      eventMontageByGroup: {},
```

Replace the assertion:

```typescript
    expect(result.current.settings.montageGridRows).toBe(2);
```

with a still-meaningful assertion against an unchanged default field, for example:

```typescript
    expect(result.current.settings.montageByGroup).toEqual({});
```

- [ ] **Step 2: Full type-check and find any stragglers**

Run: `npx tsc --noEmit`
Expected: zero errors. If any file still references a removed field (`montageLayouts`, `montageGridCols`, `montageGridRows`, `eventMontageGridCols`, `eventMontageLayouts`, `montageSavedLayouts`, `montageActiveLayoutName`, `montageHiddenMonitorIds`, `saveMontageLayout`, `saveEventMontageLayout`), fix it the same way: read from / write to the group bucket via `useMontageGroupState` (live montage) or `eventMontageByGroup` (event montage). Find them with:

```bash
grep -rn "montageLayouts\|montageGridCols\|montageGridRows\|eventMontageGridCols\|eventMontageLayouts\|montageSavedLayouts\|montageActiveLayoutName\|montageHiddenMonitorIds\|saveMontageLayout\|saveEventMontageLayout" src --include="*.ts" --include="*.tsx"
```

Expected after fixes: only the persist `migrate` function in `settings.ts` (which intentionally reads legacy keys) and test fixtures for the migration appear.

- [ ] **Step 3: Full test suite and build**

Run: `npm test`
Run: `npm run build`
Expected: all tests PASS, build SUCCEEDS.

- [ ] **Step 4: Commit**

```bash
cd app && npm test && npx tsc --noEmit && npm run build
git add src/hooks/__tests__/useCurrentProfile.test.ts
git commit -m "test(montage): update fixtures for group-keyed settings (refs #<id>)"
```

---

## Task 8: Developer-guide docs

**Files:**
- Modify: the developer-guide chapter that documents settings/montage (find it first).

- [ ] **Step 1: Locate the right chapter**

Run from the repo root:

```bash
grep -rln "ProfileSettings\|montageLayouts\|montageSavedLayouts\|selectedGroupId" docs/developer-guide/
```

Pick the chapter that documents the settings store / montage (likely the shared-services or data chapter). If none documents these, add a short subsection to the settings/data chapter.

- [ ] **Step 2: Document the group-keyed model**

Add or update a subsection describing:
- `montageByGroup: Record<string, MontageGroupLayout>` and `eventMontageByGroup: Record<string, EventMontageGroupLayout>` on `ProfileSettings`.
- The `ALL_GROUPS_KEY` sentinel and that the active key is `selectedGroupId ?? ALL_GROUPS_KEY`.
- `useMontageGroupState()` as the read/write entry point for live montage; `updateEventMontageGroupLayout` for event montage columns.
- The v0→v1 migration seeding the `__all__` bucket.
- The self-heal of a dangling `selectedGroupId` after a successful groups load.

Match the chapter's existing tone. Use real symbol names from `app/src/stores/settings.ts`. No banned words, no em-dashes.

- [ ] **Step 3: Banned-words and em-dash check**

Run from repo root (substitute the edited file path):

```bash
grep -niE "\b(comprehensive|robust|powerful|extensively|thoroughly|excellent|amazing|seamless|cutting.edge|state.of.the.art|user.friendly|ground.up rewrite)\b" docs/developer-guide/<file>
grep -n "—" docs/developer-guide/<file>
```

Both must return zero hits.

- [ ] **Step 4: Commit**

```bash
git add docs/developer-guide/<file>
git commit -m "docs(montage): document group-keyed montage settings (refs #<id>)"
```

---

## Task 9: E2E scenario

**Files:**
- Modify or create: `app/tests/features/montage.feature`
- Modify or create: `app/tests/steps/montage.steps.ts`

This task requires a running ZM server (`.env` `ZM_HOST_1` etc.) with at least two groups whose monitor sets differ. If the test environment has no groups, mark the scenario `@native`/manual and note that it is verified manually; do not delete it.

- [ ] **Step 1: Add the scenario**

Add to `app/tests/features/montage.feature` (create the file with a `Feature:` header if it does not exist; check first):

```gherkin
@web @all
Scenario: Montage arrangements follow the selected group
  Given I am logged into zmNinjaNg
  When I navigate to the "Montage" page
  And I select the group "Group A"
  And I apply a 2-column montage layout
  And I select the group "Group B"
  And I apply a 4-column montage layout
  When I select the group "Group A"
  Then the montage should show a 2-column layout
  When I refresh the page
  And I select the group "Group A"
  Then the montage should show a 2-column layout
```

- [ ] **Step 2: Implement the missing step definitions**

In `app/tests/steps/montage.steps.ts`, implement the steps that are not already defined, using the existing `TestActions` abstraction and the real `data-testid`s:
- group selection through `GroupFilterSelect` (the trigger and option items),
- applying a column layout through `GridLayoutControls` (`montage-*` testids),
- asserting the active column count by reading the grid state or a visible control.

Read the existing montage step definitions and `GroupFilterSelect.tsx` / `GridLayoutControls` for the exact testids before writing. Do not assert mere element presence: assert the column count actually changed and persisted.

If `GroupFilterSelect` or the grid controls lack a stable `data-testid` needed for the assertion, add one (`data-testid="..."` in kebab-case) in the component and reference it from the step.

- [ ] **Step 3: Run the e2e scenario**

Run: `npm run test:e2e -- montage.feature`
Expected: PASS (or, if no multi-group server is available, document the manual verification and skip in CI per the file's tags).

- [ ] **Step 4: Commit**

```bash
cd app && npm run test:e2e -- montage.feature
git add tests/features/montage.feature tests/steps/montage.steps.ts
# include any component that gained a data-testid
git commit -m "test(montage): e2e for group-scoped arrangements (refs #<id>)"
```

---

## Final verification

- [ ] `cd app && npm test` — all unit tests pass.
- [ ] `npx tsc --noEmit` — zero type errors.
- [ ] `npm run build` — build succeeds.
- [ ] `npm run test:e2e -- montage.feature` — passes, or manual verification documented.
- [ ] Manual smoke (per AGENTS cross-platform note, device runs are manual): on web, switch groups and confirm arrangements swap, columns persist per group, hidden monitors are per group, and the event montage column count is per group. Delete the selected group server-side (or simulate by clearing it) and confirm the montage falls back to All monitors with no blank dropdown.
- [ ] Request user approval before any merge to `main` (AGENTS rule 18). After the user confirms the fix works, the final commit may use `fixes #<id>`.

---

## Self-review notes (author)

- Spec coverage: group key (Task 1), data model + removals incl. `montageGridRows` and dead `eventMontageLayouts` (Task 1), migration to `__all__` (Task 1), auto-load on group switch (Task 4), accessor (Task 3), event montage cols + selector (Task 6), deleted-group self-heal (Task 2), tests (Tasks 1-3, 6, 7, 9), docs (Task 8). All spec sections map to a task.
- Type consistency: store actions `updateMontageGroupLayout` / `updateEventMontageGroupLayout`, accessor returns `{ groupKey, bucket, update }`, bucket fields `workingLayout` / `savedLayouts` / `activeLayoutName` / `gridCols` / `hiddenMonitorIds` are used identically across Tasks 1, 3, 4, 5. Event bucket field `gridCols` consistent across Tasks 1 and 6.
- Mid-migration builds: Tasks 1-4 leave the tree with known type errors until Task 7 closes them; each task's commit step notes this so an executor does not treat it as failure. Task 7 is the gate that restores a green `npm run build`.
