# Delete Developer Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user delete developer notices per-device, with a bulk Clear all and a global Restore, since the notices come from a read-only remote feed.

**Architecture:** A delete is a persisted per-device exclusion in the existing `useDeveloperNoticeStore` (new `deletedIds` array, same localStorage key). `useDeveloperNotices` filters deleted ids out of the fetched feed on every refetch. The `DeveloperNotice` page gets a per-row trash button and a kebab menu holding Mark-all, Clear all (confirmed), and Restore deleted.

**Tech Stack:** React, Zustand (+persist), React Query, Radix DropdownMenu/AlertDialog (shadcn wrappers), react-i18next, Playwright-BDD.

## Global Constraints

- Never hardcode user-facing strings; add keys to all five locales: `en`, `de`, `es`, `fr`, `zh`.
- Button/action labels must be short (fit a 320px phone).
- Use `log.*` not `console.*`; not relevant here (no logging added).
- `data-testid="kebab-case-name"` on all new interactive elements.
- Profile-scoping does not apply: notices are a device-global broadcast, so the store stays on its current localStorage key (not profile-scoped).
- Verify before commit: `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e -- developer-notice.feature`. Run all npm commands from `app/`.
- `npm run build` bumps native build numbers (`app/android/app/build.gradle`, `app/ios/App/App.xcodeproj/project.pbxproj`); revert them with `git checkout --` before committing.

---

### Task 1: Store — deletedIds and actions

**Files:**
- Modify: `app/src/stores/developerNotices.ts`
- Test: `app/src/stores/__tests__/developerNotices.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: on `useDeveloperNoticeStore`: `deletedIds: string[]`, `isDeleted(id: string): boolean`, `deleteNotice(id: string): void`, `deleteNotices(ids: string[]): void`, `restoreAllDeleted(): void`.

- [ ] **Step 1: Update the test `beforeEach` to reset the new field**

In `app/src/stores/__tests__/developerNotices.test.ts`, change the reset so `deletedIds` is cleared between tests (the persist middleware otherwise leaks it):

```ts
beforeEach(() => {
  useDeveloperNoticeStore.setState({ readIds: [], dismissedBannerIds: [], deletedIds: [] });
});
```

- [ ] **Step 2: Write the failing tests**

Append to the `describe('useDeveloperNoticeStore', ...)` block:

```ts
it('deleteNotice records an id exactly once', () => {
  const { deleteNotice } = useDeveloperNoticeStore.getState();
  deleteNotice('a');
  deleteNotice('a');
  expect(useDeveloperNoticeStore.getState().deletedIds).toEqual(['a']);
});

it('isDeleted reflects deleteNotice', () => {
  const { deleteNotice, isDeleted } = useDeveloperNoticeStore.getState();
  expect(isDeleted('a')).toBe(false);
  deleteNotice('a');
  expect(useDeveloperNoticeStore.getState().isDeleted('a')).toBe(true);
});

it('deleteNotices unions without duplicates', () => {
  const { deleteNotice, deleteNotices } = useDeveloperNoticeStore.getState();
  deleteNotice('a');
  deleteNotices(['a', 'b', 'c']);
  expect(useDeveloperNoticeStore.getState().deletedIds.sort()).toEqual(['a', 'b', 'c']);
});

it('restoreAllDeleted clears deletedIds but leaves readIds', () => {
  const { deleteNotice, markRead, restoreAllDeleted } = useDeveloperNoticeStore.getState();
  deleteNotice('a');
  markRead('a');
  restoreAllDeleted();
  expect(useDeveloperNoticeStore.getState().deletedIds).toEqual([]);
  expect(useDeveloperNoticeStore.getState().readIds).toEqual(['a']);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- developerNotices`
Expected: FAIL (`deleteNotice is not a function`).

- [ ] **Step 4: Implement the store changes**

In `app/src/stores/developerNotices.ts`, add to the `DeveloperNoticeState` interface after `dismissedBannerIds`:

```ts
  deletedIds: string[];
```

and after `dismissBanner`:

```ts
  isDeleted: (id: string) => boolean;
  deleteNotice: (id: string) => void;
  deleteNotices: (ids: string[]) => void;
  restoreAllDeleted: () => void;
```

In the store initializer, add `deletedIds: [],` next to `dismissedBannerIds: [],`, and add these actions inside the store object:

```ts
      isDeleted: (id) => get().deletedIds.includes(id),
      deleteNotice: (id) => {
        set((state) => {
          if (state.deletedIds.includes(id)) return state;
          return { ...state, deletedIds: [...state.deletedIds, id] };
        });
      },
      deleteNotices: (ids) => {
        set((state) => {
          const merged = new Set(state.deletedIds);
          ids.forEach((id) => merged.add(id));
          return { ...state, deletedIds: Array.from(merged) };
        });
      },
      restoreAllDeleted: () => {
        set((state) => (state.deletedIds.length === 0 ? state : { ...state, deletedIds: [] }));
      },
```

No persist migration is needed: existing persisted state lacks `deletedIds`, and the default shallow merge over the initializer leaves it `[]`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- developerNotices`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/stores/developerNotices.ts app/src/stores/__tests__/developerNotices.test.ts
git commit -m "feat: track per-device deleted developer-notice ids (refs #215)"
```

---

### Task 2: Hook — filter deleted ids out of the feed

**Files:**
- Modify: `app/src/hooks/useDeveloperNotices.ts`
- Test: `app/src/hooks/__tests__/useDeveloperNotices.test.ts`

**Interfaces:**
- Consumes: `useDeveloperNoticeStore.deletedIds` (Task 1).
- Produces: no signature change. `notices`, `unreadCount`, `criticalUnread` now exclude deleted ids.

- [ ] **Step 1: Update the test `beforeEach` blocks**

In `app/src/hooks/__tests__/useDeveloperNotices.test.ts`, every `useDeveloperNoticeStore.setState({ readIds: [], dismissedBannerIds: [] })` becomes:

```ts
useDeveloperNoticeStore.setState({ readIds: [], dismissedBannerIds: [], deletedIds: [] });
```

- [ ] **Step 2: Write the failing test**

Add inside `describe('useDeveloperNotices: feed deletions', ...)`:

```ts
it('excludes locally deleted ids from notices, unreadCount, and criticalUnread', async () => {
  useDeveloperNoticeStore.setState({ readIds: [], dismissedBannerIds: [], deletedIds: ['b', 'crit'] });
  fetchMock.mockResolvedValue([
    { id: 'a', title: 'A', body: '', publishedAt: '2026-05-30T18:00:00Z', severity: 'info' },
    { id: 'b', title: 'B', body: '', publishedAt: '2026-05-30T19:00:00Z', severity: 'info' },
    { id: 'crit', title: 'C', body: '', publishedAt: '2026-05-30T20:00:00Z', severity: 'critical' },
  ]);
  const { result } = renderHook(() => useDeveloperNotices(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.notices.map((n) => n.id)).toEqual(['a']);
  expect(result.current.unreadCount).toBe(1);
  expect(result.current.criticalUnread).toEqual([]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- useDeveloperNotices`
Expected: FAIL (`notices` still contains `b` and `crit`).

- [ ] **Step 4: Implement the filter**

In `app/src/hooks/useDeveloperNotices.ts`, after the `readIds` selector add:

```ts
  const deletedIds = useDeveloperNoticeStore((s) => s.deletedIds);
```

In the `useMemo`, add a `deleted` set and a filter, and add `deletedIds` to the dependency array:

```ts
  const notices = useMemo<DeveloperNoticeView[]>(() => {
    const feed = query.data ?? [];
    const appVersion = getAppVersion();
    const read = new Set(readIds);
    const deleted = new Set(deletedIds);
    return feed
      .filter((n) => import.meta.env.DEV || !n.minAppVersion || compareSemver(appVersion, n.minAppVersion) >= 0)
      .filter((n) => !deleted.has(n.id))
      .map((n) => ({ ...n, isRead: read.has(n.id) }))
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  }, [query.data, readIds, deletedIds]);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- useDeveloperNotices`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useDeveloperNotices.ts app/src/hooks/__tests__/useDeveloperNotices.test.ts
git commit -m "feat: hide locally deleted notices from the feed view (refs #215)"
```

---

### Task 3: i18n keys in all five locales

**Files:**
- Modify: `app/src/locales/en/translation.json`, `.../de/...`, `.../es/...`, `.../fr/...`, `.../zh/...`

**Interfaces:**
- Produces: keys under the existing `developer_notice` object: `delete`, `more_actions`, `clear_all`, `clear_all_confirm_title`, `clear_all_confirm_body` (uses `{{count}}`), `restore_deleted`.

- [ ] **Step 1: Add the keys to each locale's `developer_notice` object**

`en`:
```json
"delete": "Delete",
"more_actions": "More",
"clear_all": "Clear all",
"clear_all_confirm_title": "Delete all notices?",
"clear_all_confirm_body": "This deletes {{count}} notices from this device. Restore brings them back.",
"restore_deleted": "Restore deleted"
```

`de`:
```json
"delete": "Löschen",
"more_actions": "Mehr",
"clear_all": "Alle löschen",
"clear_all_confirm_title": "Alle Hinweise löschen?",
"clear_all_confirm_body": "Löscht {{count}} Hinweise auf diesem Gerät. Wiederherstellen holt sie zurück.",
"restore_deleted": "Wiederherstellen"
```

`es`:
```json
"delete": "Eliminar",
"more_actions": "Más",
"clear_all": "Borrar todo",
"clear_all_confirm_title": "¿Eliminar todos los avisos?",
"clear_all_confirm_body": "Elimina {{count}} avisos de este dispositivo. Restaurar los recupera.",
"restore_deleted": "Restaurar"
```

`fr`:
```json
"delete": "Supprimer",
"more_actions": "Plus",
"clear_all": "Tout effacer",
"clear_all_confirm_title": "Supprimer tous les avis ?",
"clear_all_confirm_body": "Supprime {{count}} avis de cet appareil. Restaurer les récupère.",
"restore_deleted": "Restaurer"
```

`zh`:
```json
"delete": "删除",
"more_actions": "更多",
"clear_all": "全部清除",
"clear_all_confirm_title": "删除所有通知？",
"clear_all_confirm_body": "将从此设备删除 {{count}} 条通知。恢复可将其找回。",
"restore_deleted": "恢复已删除"
```

Insert them inside the existing `"developer_notice": { ... }` object in each file (keep valid JSON: add a comma after the preceding entry). Do not rename existing keys.

- [ ] **Step 2: Verify the JSON parses and keys match across locales**

Run: `node -e "for (const l of ['en','de','es','fr','zh']){const o=require('./src/locales/'+l+'/translation.json').developer_notice;for (const k of ['delete','more_actions','clear_all','clear_all_confirm_title','clear_all_confirm_body','restore_deleted']) if(!o[k]) throw new Error(l+' missing '+k)};console.log('all locales ok')"`
Expected: `all locales ok`.

- [ ] **Step 3: Commit**

```bash
git add app/src/locales/*/translation.json
git commit -m "i18n: add developer-notice delete/clear/restore strings (refs #215)"
```

---

### Task 4: Per-row delete button

**Files:**
- Modify: `app/src/pages/DeveloperNotice.tsx` (the `NoticeRow` component)

**Interfaces:**
- Consumes: `useDeveloperNoticeStore.deleteNotice` (Task 1), `developer_notice.delete` (Task 3).
- Produces: a delete button with `data-testid="developer-notice-delete-<id>"` per row.

- [ ] **Step 1: Add the Trash2 import**

In the `lucide-react` import line at the top of `DeveloperNotice.tsx`, add `Trash2`:

```tsx
import { Megaphone, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, ExternalLink, RefreshCw, Eye, EyeOff, CheckCheck, Mail, Trash2, MoreVertical, RotateCcw } from 'lucide-react';
```

(`MoreVertical` and `RotateCcw` are used in Task 5; adding them now keeps one import edit.)

- [ ] **Step 2: Read `deleteNotice` in `NoticeRow`**

In `NoticeRow`, next to `markRead`/`markUnread`:

```tsx
  const deleteNotice = useDeveloperNoticeStore((s) => s.deleteNotice);
```

- [ ] **Step 3: Add the delete button**

In `NoticeRow`'s JSX, between the read-toggle button and the chevron button, insert:

```tsx
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); deleteNotice(notice.id); }}
          className="mt-0.5 p-1 rounded hover:bg-accent text-muted-foreground flex-shrink-0"
          title={t('developer_notice.delete')}
          aria-label={t('developer_notice.delete')}
          data-testid={`developer-notice-delete-${notice.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
```

- [ ] **Step 4: Verify types and build compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/DeveloperNotice.tsx
git commit -m "feat: per-row delete button on the developer-notice list (refs #215)"
```

---

### Task 5: Kebab actions, Clear all confirm, Restore, empty-state reachability

**Files:**
- Modify: `app/src/pages/DeveloperNotice.tsx` (the `DeveloperNotice` page component)

**Interfaces:**
- Consumes: `deleteNotices`, `restoreAllDeleted`, `deletedIds` (Task 1); `refetch` (existing); i18n keys (Task 3).
- Produces: kebab menu (`developer-notice-actions-menu`) with items `developer-notice-mark-all-read`, `developer-notice-mark-all-unread`, `developer-notice-clear-all`, `developer-notice-restore-deleted`; confirm dialog buttons `developer-notice-clear-all-confirm` / `-cancel`; empty-state restore `developer-notice-restore-deleted-empty`.

- [ ] **Step 1: Add imports for DropdownMenu, AlertDialog, and useState**

Ensure `useState` is imported from `react` (it already is). Add below the existing ui imports:

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
```

- [ ] **Step 2: Add store selectors and local state in `DeveloperNotice`**

After the existing `markAllRead`/`markAllUnread` selectors:

```tsx
  const deleteNotices = useDeveloperNoticeStore((s) => s.deleteNotices);
  const restoreAllDeleted = useDeveloperNoticeStore((s) => s.restoreAllDeleted);
  const deletedIds = useDeveloperNoticeStore((s) => s.deletedIds);
  const [clearAllOpen, setClearAllOpen] = useState(false);

  const hasDeleted = deletedIds.length > 0;
  const visibleIds = notices.map((n) => n.id);
  const handleRestore = () => { restoreAllDeleted(); refetch(); };
```

- [ ] **Step 3: Replace the empty-state card so Restore is reachable when the list is empty**

Replace the existing empty-state block:

```tsx
      {!isLoading && !isError && notices.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-3">
            <p>{t('developer_notice.empty_state')}</p>
            {hasDeleted && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestore}
                data-testid="developer-notice-restore-deleted-empty"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {t('developer_notice.restore_deleted')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 4: Replace the action row + list block**

Replace the whole `{notices.length > 0 && ( <> ... </> )}` block with an action row gated on `notices.length > 0 || hasDeleted`, a kebab menu, the list gated on `notices.length > 0`, and the confirm dialog:

```tsx
      {(notices.length > 0 || hasDeleted) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            title={t('developer_notice.reload')}
            aria-label={t('developer_notice.reload')}
            data-testid="developer-notice-reload"
            className="h-9 w-9"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label={t('developer_notice.more_actions')}
                data-testid="developer-notice-actions-menu"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={unreadIds.length === 0}
                onClick={() => markAllRead(unreadIds)}
                data-testid="developer-notice-mark-all-read"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.mark_all_read')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={readIds.length === 0}
                onClick={() => markAllUnread(readIds)}
                data-testid="developer-notice-mark-all-unread"
              >
                <Mail className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.mark_all_unread')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={notices.length === 0}
                onClick={() => setClearAllOpen(true)}
                className="text-destructive focus:text-destructive"
                data-testid="developer-notice-clear-all"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.clear_all')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasDeleted}
                onClick={handleRestore}
                data-testid="developer-notice-restore-deleted"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.restore_deleted')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {notices.length > 0 && (
        <div className="space-y-2" data-testid="developer-notice-list">
          {notices.map((n) => (
            <NoticeRow key={n.id} notice={n} />
          ))}
        </div>
      )}

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('developer_notice.clear_all_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('developer_notice.clear_all_confirm_body', { count: notices.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="developer-notice-clear-all-cancel">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteNotices(visibleIds)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="developer-notice-clear-all-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run the app unit suite for regressions**

Run: `npm test -- DeveloperNotice developerNotices useDeveloperNotices`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/DeveloperNotice.tsx
git commit -m "feat: kebab menu with clear-all and restore on the notice page (refs #215)"
```

---

### Task 6: E2E feature

**Files:**
- Create: `app/tests/features/developer-notice.feature`
- Create: `app/tests/steps/developer-notice.steps.ts`

**Interfaces:**
- Consumes: testids from Tasks 4 and 5. The DEV server serves the feed at `/__dev-notices.json` from `docs/notices.json` (see `vite.config.ts`), and the page route is hash-based at `/#/developer-notice`.

- [ ] **Step 1: Write the feature**

`app/tests/features/developer-notice.feature`:

```gherkin
Feature: Delete developer notices
  As a zmNinjaNg user
  I want to delete developer notices I have dealt with
  So that the list stays manageable

  Background:
    Given I am logged into zmNinjaNg
    And I am on the developer notices page

  @web
  Scenario: Delete a single notice removes it from the list
    Given the notice list has at least one notice
    When I delete the first notice
    Then the notice count should decrease by one

  @web
  Scenario: Clear all empties the list and Restore brings notices back
    Given the notice list has at least one notice
    When I clear all notices
    Then the notice list should be empty
    When I restore deleted notices
    Then the notice list should not be empty
```

- [ ] **Step 2: Write the step definitions**

`app/tests/steps/developer-notice.steps.ts`:

```ts
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// Count of delete buttons captured just before a single delete, so the
// follow-up assertion can check it went down by exactly one.
let countBeforeDelete = 0;

Given('I am on the developer notices page', async ({ page }) => {
  // The next step waits for the list; here we only need the navigation to land.
  await page.goto('/#/developer-notice', { waitUntil: 'domcontentloaded' });
});

Given('the notice list has at least one notice', async ({ page }) => {
  const list = page.getByTestId('developer-notice-list');
  await expect(list).toBeVisible();
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  await expect(deletes.first()).toBeVisible();
});

When('I delete the first notice', async ({ page }) => {
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  countBeforeDelete = await deletes.count();
  await deletes.first().click();
});

Then('the notice count should decrease by one', async ({ page }) => {
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  await expect(deletes).toHaveCount(countBeforeDelete - 1);
});

When('I clear all notices', async ({ page }) => {
  await page.getByTestId('developer-notice-actions-menu').click();
  await page.getByTestId('developer-notice-clear-all').click();
  await page.getByTestId('developer-notice-clear-all-confirm').click();
});

Then('the notice list should be empty', async ({ page }) => {
  await expect(page.getByTestId('developer-notice-list')).toHaveCount(0);
});

When('I restore deleted notices', async ({ page }) => {
  const emptyRestore = page.getByTestId('developer-notice-restore-deleted-empty');
  if (await emptyRestore.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emptyRestore.click();
    return;
  }
  await page.getByTestId('developer-notice-actions-menu').click();
  await page.getByTestId('developer-notice-restore-deleted').click();
});

Then('the notice list should not be empty', async ({ page }) => {
  await expect(page.getByTestId('developer-notice-list')).toBeVisible();
  await expect(page.locator('[data-testid^="developer-notice-delete-"]').first()).toBeVisible();
});
```

Note: Playwright uses a fresh browser context per test, so `deletedIds` in localStorage does not leak between scenarios. The "Delete a single notice" scenario relies on the DEV feed (`docs/notices.json`) containing at least one notice; it currently does.

- [ ] **Step 3: Run the e2e feature**

Run: `npm run test:e2e -- developer-notice.feature`
Expected: both scenarios PASS. If a step selector is off, fix the step (not the app) and rerun.

- [ ] **Step 4: Commit**

```bash
git add app/tests/features/developer-notice.feature app/tests/steps/developer-notice.steps.ts
git commit -m "test: e2e for developer-notice delete, clear-all, restore (refs #215)"
```

---

### Task 7: Docs, full verification, and PR

**Files:**
- Modify: `docs/developer-guide/05-component-architecture.rst` (the DeveloperNotice / store section, if present) or `docs/developer-guide/12-shared-services-and-components.rst`.

**Interfaces:** none.

- [ ] **Step 1: Document the delete/restore behavior**

Find where the developer-notice store or page is described (grep `docs/developer-guide` for `developerNotice`). Add two or three sentences: a delete is a per-device exclusion (`deletedIds` in `useDeveloperNoticeStore`), filtered out of the feed by `useDeveloperNotices`; the page offers per-row delete, Clear all (confirmed), and Restore (clears `deletedIds` and refetches). No em-dashes, no banned words.

- [ ] **Step 2: Doc lint**

Run: `grep -n "—" <edited-doc>` and the banned-words grep from `AGENTS.md`.
Expected: zero hits.

- [ ] **Step 3: Full verification**

Run in `app/`:
```bash
npm test
npx tsc --noEmit
npm run build
npm run test:e2e -- developer-notice.feature
```
Expected: all PASS.

- [ ] **Step 4: Revert incidental native build bumps**

Run: `git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj` (only if `git status` shows them modified).

- [ ] **Step 5: Commit docs and push the branch**

```bash
git add docs/developer-guide
git commit -m "docs: developer-notice per-device delete and restore (refs #215)"
git push -u origin feature/delete-developer-notices
```

- [ ] **Step 6: Open a PR for review (do not merge)**

```bash
gh pr create --repo ZoneMinder/zmNinjaNg --base main --head feature/delete-developer-notices \
  --title "feat: delete developer notices per-device (fixes #215)" \
  --body "Implements the design in docs/superpowers/specs/2026-07-03-delete-developer-notices-design.md. Per-device delete, Clear all (confirmed), and Restore. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Wait for user approval before merging (AGENTS.md rule 18).

---

## Notes for the implementer

- Run every `npm` command from `app/`.
- Keep commits one-logical-change each, as split above.
- The store persists to localStorage; adding `deletedIds` needs no migration (default merge fills it with `[]`).
- Deleting a critical notice also removes its banner, by design (it leaves `criticalUnread`).
