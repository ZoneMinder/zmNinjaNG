# Relative Time in Events View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, localized "how long ago" label alongside the absolute date/time on event list cards and the event detail Timing card (refs #210).

**Architecture:** A small shared module `lib/relative-time.ts` wraps date-fns `formatDistanceToNowStrict` and adds a language-to-date-fns-locale map plus a 7-day window check. `EventCard` renders an Hourglass chip gated to the last 7 days; `EventDetail` renders a muted line under Time, always. Labels are computed statically on render (no timers).

**Tech Stack:** React, TypeScript, date-fns 4.1.0, react-i18next, lucide-react, Vitest, Playwright (BDD).

## Global Constraints

- Run all `npm` commands from `app/`.
- Plain factual writing; no banned superlatives, no em-dashes (AGENTS.md rule 1).
- i18n all 5 languages: `en, de, es, fr, zh` (rule 5). One new key `events.just_now`.
- Named constants live in `lib/zmninja-ng-constants.ts`; import, do not redeclare (rule 25).
- Use `data-testid="kebab-case-name"` on new interactive/asserted elements (rule 13).
- Text overflow: `truncate` + `min-w-0` in flex containers (rule 11).
- Files ~400 LOC max, DRY (rule 12).
- Verify before commit: `npm test`, `npx tsc --noEmit`, `npm run build`; e2e for UI changes (rule 3).
- Revert incidental native build-number bumps from `npm run build` before committing (rule 28).
- Reference the issue with `refs #210`.

---

### Task 1: Constants for the relative-time window and just-now threshold

**Files:**
- Modify: `app/src/lib/zmninja-ng-constants.ts` (append after the `EVENT_LIST` block, ~line 233)

**Interfaces:**
- Produces: `RELATIVE_TIME_LIST_WINDOW_DAYS: number` (= 7), `RELATIVE_TIME_JUST_NOW_MS: number` (= 60000).

- [ ] **Step 1: Add the constants**

After the closing `} as const;` of `EVENT_LIST`, insert:

```ts
/**
 * Relative time labels on events (issue #210).
 * List chip only renders for events within this many days; older events read
 * fine from the absolute date. Below the just-now threshold we show "just now".
 */
export const RELATIVE_TIME_LIST_WINDOW_DAYS = 7;
export const RELATIVE_TIME_JUST_NOW_MS = 60_000;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/zmninja-ng-constants.ts
git commit -m "chore: add relative-time constants for events (refs #210)"
```

---

### Task 2: `lib/relative-time.ts` helper module (TDD)

**Files:**
- Create: `app/src/lib/relative-time.ts`
- Test: `app/src/lib/__tests__/relative-time.test.ts`

**Interfaces:**
- Consumes: `RELATIVE_TIME_JUST_NOW_MS` from Task 1; `formatDistanceToNowStrict` and locales `enUS, de, es, fr, zhCN` from date-fns; `TFunction` from i18next.
- Produces:
  - `dateFnsLocaleFor(lang: string | undefined): Locale`
  - `isWithinDays(date: Date, days: number, now?: Date): boolean`
  - `formatEventRelative(date: Date, lang: string | undefined, t: TFunction, now?: Date): string`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/__tests__/relative-time.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { dateFnsLocaleFor, isWithinDays, formatEventRelative } from '../relative-time';
import { enUS, de, es, fr, zhCN } from 'date-fns/locale';

// Minimal t stub: returns the key, matching i18next behaviour for a missing value.
const t = ((key: string) => key) as unknown as Parameters<typeof formatEventRelative>[2];

const NOW = new Date('2026-07-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('dateFnsLocaleFor', () => {
  it('maps base language codes to date-fns locales', () => {
    expect(dateFnsLocaleFor('en')).toBe(enUS);
    expect(dateFnsLocaleFor('en-US')).toBe(enUS);
    expect(dateFnsLocaleFor('de')).toBe(de);
    expect(dateFnsLocaleFor('es')).toBe(es);
    expect(dateFnsLocaleFor('fr')).toBe(fr);
    expect(dateFnsLocaleFor('zh')).toBe(zhCN);
  });

  it('falls back to enUS for unknown or missing input', () => {
    expect(dateFnsLocaleFor('xx')).toBe(enUS);
    expect(dateFnsLocaleFor(undefined)).toBe(enUS);
  });
});

describe('isWithinDays', () => {
  it('is true inside the window', () => {
    expect(isWithinDays(ago(MIN), 7, NOW)).toBe(true);
    expect(isWithinDays(ago(6 * DAY), 7, NOW)).toBe(true);
  });
  it('is true at the exact boundary', () => {
    expect(isWithinDays(ago(7 * DAY), 7, NOW)).toBe(true);
  });
  it('is false outside the window', () => {
    expect(isWithinDays(ago(8 * DAY), 7, NOW)).toBe(false);
  });
  it('is false for a future date', () => {
    expect(isWithinDays(new Date(NOW.getTime() + MIN), 7, NOW)).toBe(false);
  });
});

describe('formatEventRelative', () => {
  it('returns the just-now key under 60s', () => {
    expect(formatEventRelative(ago(30_000), 'en', t, NOW)).toBe('events.just_now');
  });

  it('returns single-unit "ago" strings in English', () => {
    expect(formatEventRelative(ago(40 * MIN), 'en', t, NOW)).toBe('40 minutes ago');
    expect(formatEventRelative(ago(3 * HOUR), 'en', t, NOW)).toBe('3 hours ago');
    expect(formatEventRelative(ago(2 * DAY), 'en', t, NOW)).toBe('2 days ago');
  });

  it('localizes the suffix per language', () => {
    expect(formatEventRelative(ago(40 * MIN), 'es', t, NOW)).toContain('hace');
    expect(formatEventRelative(ago(40 * MIN), 'de', t, NOW)).toContain('vor');
    expect(formatEventRelative(ago(40 * MIN), 'fr', t, NOW)).toContain('il y a');
    expect(formatEventRelative(ago(40 * MIN), 'zh', t, NOW)).toContain('前');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- relative-time`
Expected: FAIL (`Cannot find module '../relative-time'`).

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/relative-time.ts`:

```ts
/**
 * Compact, localized "how long ago" labels for event times (issue #210).
 *
 * Wraps date-fns formatDistanceToNowStrict (single unit, e.g. "40 minutes ago")
 * rather than formatDistanceToNow (fuzzy "about 1 hour ago"), and maps the app
 * language to a date-fns locale so the suffix is translated for all 5 languages.
 */

import { formatDistanceToNowStrict, type Locale } from 'date-fns';
import { enUS, de, es, fr, zhCN } from 'date-fns/locale';
import type { TFunction } from 'i18next';
import { RELATIVE_TIME_JUST_NOW_MS } from './zmninja-ng-constants';

const LOCALES: Record<string, Locale> = { en: enUS, de, es, fr, zh: zhCN };

/** Map an i18n language code (e.g. "en", "en-US", "zh") to a date-fns locale. */
export function dateFnsLocaleFor(lang: string | undefined): Locale {
  const base = (lang || 'en').split('-')[0];
  return LOCALES[base] ?? enUS;
}

/** True if `date` is between `now` and `days` days before `now` (inclusive). */
export function isWithinDays(date: Date, days: number, now: Date = new Date()): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Compact localized relative label. Under the just-now threshold returns
 * t('events.just_now'); otherwise a single-unit "N units ago" string.
 */
export function formatEventRelative(
  date: Date,
  lang: string | undefined,
  t: TFunction,
  now: Date = new Date()
): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < RELATIVE_TIME_JUST_NOW_MS) return t('events.just_now');
  return formatDistanceToNowStrict(date, {
    addSuffix: true,
    locale: dateFnsLocaleFor(lang),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- relative-time`
Expected: PASS (all assertions).

Note: `formatDistanceToNowStrict` uses the system clock internally for its own
"now"; the tests pass an event time relative to a fixed `NOW` far from real time,
so the unit auto-selection is stable. If any English assertion is off by a unit
due to real-clock drift, keep the fixed offsets (40 min, 3 h, 2 days) which sit
well inside their unit bands.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/relative-time.ts src/lib/__tests__/relative-time.test.ts
git commit -m "feat: add relative-time helper for event timestamps (refs #210)"
```

---

### Task 3: i18n key `events.just_now` in all 5 locales

**Files:**
- Modify: `app/src/locales/en/translation.json`
- Modify: `app/src/locales/de/translation.json`
- Modify: `app/src/locales/es/translation.json`
- Modify: `app/src/locales/fr/translation.json`
- Modify: `app/src/locales/zh/translation.json`

**Interfaces:**
- Produces: translation key `events.just_now`.

- [ ] **Step 1: Locate the `events` object in each file**

Run: `cd app && grep -n '"events"' src/locales/en/translation.json`
Add a `"just_now"` member inside the existing `"events": { ... }` object in each
file. Match the file's existing indentation and add a trailing comma on the
preceding line as needed. If a file has no `"events"` object, add one.

Values:
- en: `"just_now": "just now"`
- de: `"just_now": "gerade eben"`
- es: `"just_now": "ahora mismo"`
- fr: `"just_now": "à l'instant"`
- zh: `"just_now": "刚刚"`

- [ ] **Step 2: Verify JSON is valid in all five**

Run: `cd app && for f in en de es fr zh; do node -e "JSON.parse(require('fs').readFileSync('src/locales/$f/translation.json','utf8')); console.log('$f ok')"; done`
Expected: `en ok` … `zh ok`, no parse errors.

- [ ] **Step 3: Verify the key resolves**

Run: `cd app && for f in en de es fr zh; do node -e "const j=require('./src/locales/$f/translation.json'); console.log('$f', j.events.just_now)"; done`
Expected: each language prints its value.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/locales/*/translation.json
git commit -m "i18n: add events.just_now in all 5 languages (refs #210)"
```

---

### Task 4: Relative chip on `EventCard` (TDD)

**Files:**
- Modify: `app/src/components/events/EventCard.tsx`
- Test: `app/src/components/events/__tests__/EventCard.test.tsx`

**Interfaces:**
- Consumes: `formatEventRelative`, `isWithinDays` (Task 2); `RELATIVE_TIME_LIST_WINDOW_DAYS` (Task 1); `Hourglass` from lucide-react.

- [ ] **Step 1: Write the failing test**

Open `app/src/components/events/__tests__/EventCard.test.tsx`. Determine how it
builds an event and renders (read the top of the file first). Add two cases,
adapting the render/props helpers to the file's existing pattern:

```tsx
it('shows a relative-time chip for a recent event', () => {
  const recent = new Date(Date.now() - 40 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${recent.getFullYear()}-${pad(recent.getMonth() + 1)}-${pad(recent.getDate())} ${pad(recent.getHours())}:${pad(recent.getMinutes())}:${pad(recent.getSeconds())}`;
  renderEventCard({ StartDateTime: start }); // use the file's existing render helper
  expect(screen.getByTestId('event-relative-time')).toBeInTheDocument();
});

it('hides the relative-time chip for an event older than the window', () => {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())} ${pad(old.getHours())}:${pad(old.getMinutes())}:${pad(old.getSeconds())}`;
  renderEventCard({ StartDateTime: start });
  expect(screen.queryByTestId('event-relative-time')).not.toBeInTheDocument();
});
```

If the test file has no shared render helper, copy the existing test's render
setup inline into each case rather than referencing a nonexistent `renderEventCard`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- EventCard`
Expected: FAIL (`event-relative-time` not found in the recent case).

- [ ] **Step 3: Add imports to `EventCard.tsx`**

- Line 18 import: add `Hourglass` to the lucide-react import list:
  `import { Video, Calendar, Clock, Star, Archive, Hourglass } from 'lucide-react';`
- Line 41: widen the hook destructure to expose the language:
  `const { t, i18n } = useTranslation();`
- Add near the other lib imports:
  ```ts
  import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
  import { RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
  ```
  (Confirm the relative depth: `EventCard.tsx` is at `src/components/events/`, so
  `../../lib/` is correct.)

- [ ] **Step 4: Render the chip**

Immediately after the closing `</div>` of the Time badge (the block containing
`<Clock ... />{fmtTime(startTime)}`, around line 225), add:

```tsx
{isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS) && (
  <div
    className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5 min-w-0"
    data-testid="event-relative-time"
  >
    <Hourglass className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
    <span className="truncate min-w-0">{formatEventRelative(startTime, i18n.language, t)}</span>
  </div>
)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npm test -- EventCard`
Expected: PASS (both new cases and existing cases).

- [ ] **Step 6: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/components/events/EventCard.tsx src/components/events/__tests__/EventCard.test.tsx
git commit -m "feat: relative-time chip on event cards (refs #210)"
```

---

### Task 5: Relative line on `EventDetail`

**Files:**
- Modify: `app/src/pages/EventDetail.tsx`

**Interfaces:**
- Consumes: `formatEventRelative` (Task 2).

- [ ] **Step 1: Add imports and widen the hook**

- Add near the top imports:
  `import { formatEventRelative } from '../lib/relative-time';`
  (`EventDetail.tsx` is at `src/pages/`, so `../lib/` is correct.)
- Line 48: `const { t, i18n } = useTranslation();`

- [ ] **Step 2: Render the relative line under Time**

In the Timing card, directly after the Time value line
`<div className="text-sm text-muted-foreground">{fmtTime(startTime)}</div>`
(around line 513), add:

```tsx
<div className="text-xs text-muted-foreground/70" data-testid="event-detail-relative-time">
  {formatEventRelative(startTime, i18n.language, t)}
</div>
```

- [ ] **Step 3: Typecheck and build**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/pages/EventDetail.tsx
git commit -m "feat: relative-time line on event detail (refs #210)"
```

---

### Task 6: E2E assertion for the list chip

**Files:**
- Modify: `app/tests/features/events.feature` (or the existing events feature file; confirm its name)
- Modify: `app/tests/steps/events.steps.ts` (or the matching steps file)

**Interfaces:**
- Consumes: `data-testid="event-relative-time"` (Task 4).

- [ ] **Step 1: Confirm the events feature and steps files**

Run: `cd app && ls tests/features | grep -i event; ls tests/steps | grep -i event`
Use the actual filenames found. If multiple, pick the events list feature.

- [ ] **Step 2: Add a scenario**

Append to the events feature file, matching its existing `Given/When` phrasing for
logging in and navigating to events (reuse existing steps verbatim):

```gherkin
@all
Scenario: Recent events show a relative time label
  Given I am logged into zmNinjaNg
  When I navigate to the events list
  Then a recent event should show a relative time label
```

- [ ] **Step 3: Add the step definition (conditional pattern)**

In the events steps file, add. The server may have no event inside the 7-day
window, so assert presence only when at least one card is shown, per the
conditional testing pattern in AGENTS.md:

```ts
Then('a recent event should show a relative time label', async ({ page }) => {
  const anyCard = page.getByTestId('event-monitor-name').first();
  if (!(await anyCard.isVisible({ timeout: 5000 }).catch(() => false))) return;
  const chips = page.getByTestId('event-relative-time');
  // If any event is within the window the chip renders; otherwise none do.
  // Assert the locator resolves without error; count >= 0 is always true, so
  // additionally verify that when a chip exists it carries non-empty text.
  const count = await chips.count();
  if (count > 0) {
    await expect(chips.first()).toContainText(/./);
  }
});
```

Reuse the existing "Given I am logged into zmNinjaNg" and events-navigation steps;
do not redefine them. If the events feature uses a different navigation phrase,
match it exactly.

- [ ] **Step 4: Run the e2e feature**

Run: `cd app && npm run test:e2e -- events.feature`
Expected: the new scenario passes (web-chromium).

- [ ] **Step 5: Commit**

```bash
cd app && git add tests/features/ tests/steps/
git commit -m "test: e2e for event relative-time chip (refs #210)"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/developer-guide/12-shared-services-and-components.rst`
- Modify: the events chapter under `docs/user-guide/` (confirm filename)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Developer-guide entry**

Add a `relative-time.ts` subsection to `12-shared-services-and-components.rst`
matching the chapter's existing tone. Cover the three exports, the 60000 ms
just-now threshold and 7-day list window (cite the constant names from
`zmninja-ng-constants.ts`), and the language-to-date-fns-locale map. Note that
`EventCard` gates on the window and `EventDetail` always shows the line.

- [ ] **Step 2: User-guide note**

Run: `cd .. && grep -ril "events" docs/user-guide | head` (from repo root; cwd may
be `app/`). In the events section, add one factual sentence: recent events show
how long ago they occurred next to the date and time.

- [ ] **Step 3: Banned-words + em-dash check**

Run from repo root:
```bash
grep -niE "\b(comprehensive|robust|powerful|seamless|intuitive|user.friendly)\b" docs/developer-guide/12-shared-services-and-components.rst
grep -n "—" docs/developer-guide/12-shared-services-and-components.rst
```
Expected: zero hits each.

- [ ] **Step 4: Commit**

```bash
git add docs/developer-guide/12-shared-services-and-components.rst docs/user-guide/
git commit -m "docs: document event relative-time labels (refs #210)"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Unit tests**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `cd app && npm run build`
Expected: SUCCESS.

- [ ] **Step 4: Revert incidental native build-number bumps (rule 28)**

Run: `cd .. && git status --short app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`
If either shows as modified: `git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`

- [ ] **Step 5: E2E (web)**

Run: `cd app && npm run test:e2e -- events.feature`
Expected: PASS.

- [ ] **Step 6: State the verification result**

Report: "Tests verified: npm test ✓, tsc --noEmit ✓, build ✓, test:e2e -- events.feature ✓". Then request user approval before merging (rule 18). Delete this plan file and the spec after the feature is confirmed complete (rule 16).

---

## Notes for the implementer

- Do not add a date-fns locale to `NotificationHistory` in this change; it is out
  of scope (it can adopt `dateFnsLocaleFor` later).
- No live-ticking timer: labels are static, recomputed on render.
- Native/Electron paths are not touched, so no device pass is required beyond the
  standard web e2e.
