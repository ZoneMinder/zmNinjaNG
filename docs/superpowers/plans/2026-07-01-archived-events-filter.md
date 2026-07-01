# Archived-Only Events Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Archived only" toggle to the events filter that restricts the list to archived events, mirroring the existing Favorites filter (refs #209).

**Architecture:** Wire the already-declared `EventFilters.archived` field into the query builder as an `Archived:1` server segment. Add an `archivedOnly` boolean through the filter hook (state, per-profile persistence, URL param, active-count) exactly as `favoritesOnly` is handled, surface a toggle in the filter popover, and pass it from the Events page. The archive mark/unmark action already exists on the detail screen and is out of scope.

**Tech Stack:** React, TypeScript, Zustand settings store, react-router search params, react-i18next, Vitest, @testing-library/react, Playwright (BDD).

## Global Constraints

- Run all `npm` commands from `app/`.
- Plain factual writing; no banned superlatives; no em-dashes.
- i18n all 5 languages (`en, de, es, fr, zh`); new key `events.archived_only`.
- Never hardcode user-facing strings.
- Profile-scoped settings via the settings store (`eventsPageFilters`); mirror `favoritesOnly`.
- `data-testid` on new interactive elements (`events-archived-toggle`).
- Verify before commit: `npm test`, `npx tsc --noEmit`, `npm run build`; e2e for UI changes.
- Revert incidental native build-number bumps before committing.
- Reference the issue with `refs #209`.

---

### Task 1: Wire `archived` into the query builder

**Files:**
- Modify: `app/src/api/events.ts` (the `getEvents` filter-segment section, after the `cause` block near line 187)
- Test: `app/src/api/__tests__/events.test.ts`

**Interfaces:**
- Consumes: existing `EventFilters.archived?: boolean` (already declared).
- Produces: `getEvents` emits an `Archived:1` path segment when `filters.archived` is truthy.

- [ ] **Step 1: Write the failing test**

Add to `app/src/api/__tests__/events.test.ts` (inside the top-level `describe`, near the existing "applies filters" test). It follows the existing URL-assertion pattern (`mockGet.mock.calls[0][0]`, encoded segments):

```ts
it('adds the Archived segment when archived is set', async () => {
  mockGet.mockResolvedValue({
    data: {
      events: [buildEventData(10)],
      pagination: { pageCount: 1, page: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 100 },
    },
  });

  await getEvents({ archived: true, monitorId: '1' });

  const call = mockGet.mock.calls[0][0] as string;
  expect(call).toContain('Archived%3A1');
  expect(call).toContain('MonitorId%3A1');
});

it('does not add the Archived segment when archived is false', async () => {
  mockGet.mockResolvedValue({
    data: {
      events: [buildEventData(10)],
      pagination: { pageCount: 1, page: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 100 },
    },
  });

  await getEvents({ archived: false });

  const call = mockGet.mock.calls[0][0] as string;
  expect(call).not.toContain('Archived');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npm test -- events.test`
Expected: FAIL (URL has no `Archived%3A1`).

- [ ] **Step 3: Implement**

In `app/src/api/events.ts`, directly after the `if (filters.cause) { ... }` block (near line 187):

```ts
  if (filters.archived) {
    addFilterSegment('Archived:1');
  }
```

`Archived:1` is ZM's equals form (same shape as `MonitorId:${id}`). It lands in
`filterSegments`, which is included in both the direct path and the
`fetchEventsByVariants` base, so it composes with favorites (`Id IN:`) and tags.

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npm test -- events.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/api/events.ts src/api/__tests__/events.test.ts
git commit -m "feat: filter events by archived via Archived:1 segment (refs #209)"
```

---

### Task 2: `archivedOnly` in settings + filter hook

**Files:**
- Modify: `app/src/stores/settings.ts` (the `eventsPageFilters` type near line 130 and its default near line 273)
- Modify: `app/src/hooks/useEventFilters.ts`
- Test: `app/src/hooks/__tests__/useEventFilters.test.ts`

**Interfaces:**
- Consumes: `EventFilters.archived` (Task 1).
- Produces: hook returns `archivedOnly: boolean` and `setArchivedOnly: (v: boolean) => void`; derived `filters.archived` is set from `archivedOnly`.

- [ ] **Step 1: Add the persisted field to settings**

In `app/src/stores/settings.ts`, in the `eventsPageFilters` type object (after `favoritesOnly: boolean;`, line 135):

```ts
    archivedOnly: boolean;
```

And in the `eventsPageFilters` default object (after `favoritesOnly: false,`, near line 278):

```ts
    archivedOnly: false,
```

- [ ] **Step 2: Write the failing hook test**

Open `app/src/hooks/__tests__/useEventFilters.test.ts`. Find the existing test that exercises `favoritesOnly` (URL param `favorites` and/or persistence) and add a parallel case for `archivedOnly`. Match the file's existing render/setup helpers exactly; do not invent new ones. The assertion shape:

```ts
it('reflects archivedOnly in the archived URL param', () => {
  const { result } = renderHook(); // use the file's existing render helper
  act(() => result.current.setArchivedOnly(true));
  act(() => result.current.applyFilters());
  // The file's existing favorites test shows how it reads the URL; mirror it.
  expect(getSearchParam('archived')).toBe('true'); // use the file's helper/assertion
});
```

If the existing favorites test asserts persistence via the settings store instead
of the URL, mirror that shape instead. The point: toggling `archivedOnly` must
round-trip through the same mechanism `favoritesOnly` uses.

- [ ] **Step 3: Run to verify it fails**

Run: `cd app && npm test -- useEventFilters`
Expected: FAIL (`setArchivedOnly` undefined).

- [ ] **Step 4: Implement the hook wiring**

In `app/src/hooks/useEventFilters.ts`, mirror every `favoritesOnly` site:

1. Return type `UseEventFiltersReturn` (after `favoritesOnly: boolean;`):
```ts
  archivedOnly: boolean;
```
and (after `setFavoritesOnly: ...;`):
```ts
  setArchivedOnly: (enabled: boolean) => void;
```

2. State (after the `favoritesOnly` useState, line 90):
```ts
  const [archivedOnly, _setArchivedOnly] = useState(false);
```

3. Setter (after `setFavoritesOnly`, line 123):
```ts
  const setArchivedOnly = useCallback((enabled: boolean) => {
    _setArchivedOnly(enabled);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'archivedOnly', enabled);
  }, []);
```

4. Restore-from-settings block (after `_setFavoritesOnly(saved.favoritesOnly);`, line 161). Use `?? false` because older persisted settings predate this field:
```ts
    _setArchivedOnly(saved.archivedOnly ?? false);
```

5. Both URL-priority guards (lines 142-148 and 171-176) add:
```ts
      searchParams.has('archived') ||
```
(place it alongside `searchParams.has('favorites')`).

6. First-render deep-link handler (near line 183-189), read and set:
```ts
        const a = searchParams.get('archived');
        setArchivedOnly(a === 'true');
```

7. Ongoing search-param handler (near line 198-204):
```ts
    const archived = searchParams.get('archived');
    if (archived !== null) _setArchivedOnly(archived === 'true');
```

8. Derived `filters` memo (lines 208-219) add the field and dep:
```ts
      archived: archivedOnly || undefined,
```
and add `archivedOnly` to that memo's dependency array (line 218).

9. `applyFilters` URL write (after the favorites block, line 251):
```ts
    if (archivedOnly) {
      newParams.set('archived', 'true');
    } else {
      newParams.delete('archived');
    }
```
and add `archivedOnly` to `applyFilters`' dependency array (line 260).

10. `clearFilters` (line 264-283): add `setArchivedOnly(false);` alongside
    `setFavoritesOnly(false);`, `newParams.delete('archived');` alongside
    `newParams.delete('favorites');`, and add `setArchivedOnly` to its dep array.

11. `activeFilterCount` memo (lines 319-330): add `archivedOnly ? 1 : null,` and add
    `archivedOnly` to its dep array.

12. Return object (lines 332-336): add `archivedOnly,` and `setArchivedOnly,`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd app && npm test -- useEventFilters`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/stores/settings.ts src/hooks/useEventFilters.ts src/hooks/__tests__/useEventFilters.test.ts
git commit -m "feat: add archivedOnly to event filter state and persistence (refs #209)"
```

---

### Task 3: i18n `events.archived_only`

**Files:**
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json`

**Interfaces:**
- Produces: key `events.archived_only`.

- [ ] **Step 1: Add the key**

In each file, inside the existing `events` object next to `favorites_only`
(`grep -n 'favorites_only' src/locales/en/translation.json` to find it), add
`archived_only` with these values (mind the trailing comma on the preceding line):
- en: "Archived only"
- de: "Nur archivierte"
- es: "Solo archivados"
- fr: "Archivés seulement"
- zh: "仅已存档"

- [ ] **Step 2: Validate JSON and key**

Run: `cd app && for f in en de es fr zh; do node -e "const j=require('./src/locales/$f/translation.json'); console.log('$f', j.events.archived_only)"; done`
Expected: each prints its value; no parse error.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/locales/*/translation.json
git commit -m "i18n: add events.archived_only in all 5 languages (refs #209)"
```

---

### Task 4: Filter popover toggle + Events page wire-through

**Files:**
- Modify: `app/src/components/events/EventsFilterPopover.tsx`
- Modify: `app/src/pages/Events.tsx`

**Interfaces:**
- Consumes: `archivedOnly` / `setArchivedOnly` from `useEventFilters` (Task 2); `events.archived_only` (Task 3).

- [ ] **Step 1: Add popover props**

In `EventsFilterPopover.tsx`, in `EventsFilterPopoverProps` (after
`onFavoritesOnlyChange`, line 27):
```ts
  archivedOnly: boolean;
  onArchivedOnlyChange: (value: boolean) => void;
```
and destructure them in the component signature (after `onFavoritesOnlyChange,`):
```ts
  archivedOnly,
  onArchivedOnlyChange,
```

- [ ] **Step 2: Add the toggle row**

Directly after the Favorites filter block (the `<div>` closing near line 138,
before the Object-detection block), add. Reuse the existing `Archive` icon if the
file imports one; otherwise import `Archive` from `lucide-react` alongside the
other icon imports:

```tsx
        {/* Archived filter */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="archived-only" className="cursor-pointer">
              {t('events.archived_only')}
            </Label>
          </div>
          <Switch
            id="archived-only"
            checked={archivedOnly}
            onCheckedChange={onArchivedOnlyChange}
            data-testid="events-archived-toggle"
          />
        </div>
```

Add `Archive` to the existing `lucide-react` import in this file if not present.

- [ ] **Step 3: Wire through `Events.tsx`**

In `app/src/pages/Events.tsx`:
- Add `archivedOnly` and `setArchivedOnly` to the `useEventFilters()` destructure
  (alongside `favoritesOnly` / `setFavoritesOnly`; grep for `favoritesOnly` in the
  file to find both the destructure and the `<EventsFilterPopover>` usage).
- Pass to the popover, next to the favorites props:
```tsx
        archivedOnly={archivedOnly}
        onArchivedOnlyChange={setArchivedOnly}
```

`serverFilters` already spreads `...filters`, and Task 2 puts `archived` into the
derived `filters`, so no `serverFilters` change is needed. Confirm by grep that
`serverFilters` starts with `...filters`.

- [ ] **Step 4: Typecheck and build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/components/events/EventsFilterPopover.tsx src/pages/Events.tsx
git commit -m "feat: archived-only toggle in the events filter popover (refs #209)"
```

---

### Task 5: E2E for the archived toggle

**Files:**
- Modify: `app/tests/features/events.feature`
- Modify: `app/tests/steps/events.steps.ts` (confirm the filename with `ls tests/steps | grep -i event`)

**Interfaces:**
- Consumes: `events-archived-toggle`, and the existing filter popover open control.

- [ ] **Step 1: Read the existing favorites/filter e2e**

Run: `cd app && grep -n "favorites\|filter\|events-filter" tests/features/events.feature tests/steps/events.steps.ts | head`. Reuse the existing steps that open the filter popover and log in; mirror the favorites scenario if one exists.

- [ ] **Step 2: Add a scenario**

```gherkin
@all
Scenario: Filter events to archived only
  Given I am logged into zmNinjaNg
  When I navigate to the events list
  And I open the events filter panel
  And I toggle the archived-only filter
  And I apply event filters
  Then I should see events list or empty state
```

Reuse existing steps for login, navigation, opening the panel, and applying;
only "I toggle the archived-only filter" is new.

- [ ] **Step 3: Add the step definition**

In the events steps file, matching its raw-`page` style:

```ts
When('I toggle the archived-only filter', async ({ page }) => {
  await page.getByTestId('events-archived-toggle').click();
});
```

If the filter panel must be open first, reuse the existing "open the events filter
panel" step in the scenario rather than opening it here.

- [ ] **Step 4: Run the e2e feature**

Run: `cd app && npm run test:e2e -- events.feature`
Expected: the new scenario passes on web-chromium (list or empty state, since the
server may have no archived events).

- [ ] **Step 5: Commit**

```bash
cd app && git add tests/features/events.feature tests/steps/
git commit -m "test: e2e for archived-only events filter (refs #209)"
```

---

### Task 6: Docs

**Files:**
- Modify: the developer-guide chapter documenting events API / filters (confirm with grep)
- Modify: the user-guide events/filter section (confirm with grep)

- [ ] **Step 1: Developer guide**

Run from repo root: `grep -rln "EventFilters\|getEvents\|events filter" docs/developer-guide`. Note that `EventFilters.archived` is wired to the `Archived:1` segment and composes with the other filters, and that `archivedOnly` persists per profile like `favoritesOnly`.

- [ ] **Step 2: User guide**

Run from repo root: `grep -rln "favorites\|filter\|events" docs/user-guide`. In the events filter section, add that "Archived only" restricts the list to archived events, and events are archived from the event detail screen.

- [ ] **Step 3: Lint docs**

Run from repo root on each edited file:
```bash
grep -niE "\b(comprehensive|robust|powerful|seamless|intuitive|user.friendly)\b" <file>
grep -n "—" <file>
```
Both zero. Fix any hits.

- [ ] **Step 4: Commit**

```bash
git add docs/developer-guide docs/user-guide
git commit -m "docs: document archived-only events filter (refs #209)"
```

---

### Task 7: Full verification pass

**Files:** none.

- [ ] **Step 1: Unit tests** — `cd app && npm test` (all pass).
- [ ] **Step 2: Typecheck** — `cd app && npx tsc --noEmit` (clean).
- [ ] **Step 3: Build** — `cd app && npm run build` (exit 0).
- [ ] **Step 4: Revert native build-number bumps** — from repo root: `git status --short app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`; if modified, `git checkout -- <those files>`.
- [ ] **Step 5: E2E (web)** — `cd app && npm run test:e2e -- events.feature` (pass).
- [ ] **Step 6: State the verification result.** Delete this plan and the spec after the feature is confirmed complete.

---

## Notes for the implementer

- Do not touch the archive mark/unmark action; it already exists on `EventDetail`.
- `archived` is a real ZM field, so it filters server-side and composes with
  monitor/date/favorites/tags. Favorites, by contrast, is a local ID set.
- Read older persisted settings with `saved.archivedOnly ?? false` so profiles
  saved before this field still load.
