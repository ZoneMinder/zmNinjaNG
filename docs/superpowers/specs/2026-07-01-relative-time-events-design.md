# Relative time in events view (#210)

## Problem

The events list and event detail show only absolute date/time ("Jun 20, 16:20").
Scanning for recently-occurred events forces the user to do date math. Issue #210
asks for a relative label alongside the absolute time, e.g. "Jun 20, 16:20
(40 minutes ago)".

## Decisions

- **Placement**: event list cards (`EventCard`) and the event detail Timing card
  (`EventDetail`).
- **Style**: append the relative label alongside the existing absolute date/time.
  Do not replace it. No information is lost.
- **Compactness**: use date-fns `formatDistanceToNowStrict` (single unit, e.g.
  "40 minutes ago") rather than `formatDistanceToNow` (fuzzy "about 1 hour ago").
  The chip sits in the existing `flex flex-wrap` row and wraps to its own line on
  narrow (320px) screens instead of overflowing.
- **List gating**: the list chip renders only when the event started within the
  last 7 days. Older events read fine from the absolute date, and gating keeps the
  row uncluttered and short on small devices.
- **Detail**: shown regardless of age (a single focused screen with room).
- **Freshness**: static, computed from `Date.now()` on render. Refreshes when the
  list refetches or re-renders. No timers.
- **Always on**: no setting toggle.

## Why reuse date-fns instead of a new formatter

`formatDistanceToNowStrict` is the single-unit sibling of `formatDistanceToNow`
already used in `NotificationHistory.tsx`. It is localized for all five app
languages out of the box. The only genuinely new, reusable piece is a language to
date-fns-locale map, which is needed for i18n regardless (the existing
`NotificationHistory` usage is English-only today because no such map exists).

## New module: `app/src/lib/relative-time.ts`

```ts
import { formatDistanceToNowStrict } from 'date-fns';
import { enUS, de, es, fr, zhCN } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import type { TFunction } from 'i18next';

const LOCALES: Record<string, Locale> = { en: enUS, de, es, fr, zh: zhCN };

/** Map an i18n language code (e.g. "en", "en-US", "zh") to a date-fns locale. */
export function dateFnsLocaleFor(lang: string | undefined): Locale {
  const base = (lang || 'en').split('-')[0];
  return LOCALES[base] ?? enUS;
}

/** True if `date` started within the last `days` days relative to `now`. */
export function isWithinDays(date: Date, days: number, now: Date = new Date()): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Compact, localized relative label for an event start time.
 * Under 60s returns t('events.just_now'); otherwise a single-unit
 * "N minutes ago" style string localized to `lang`.
 */
export function formatEventRelative(
  date: Date,
  lang: string | undefined,
  t: TFunction,
  now: Date = new Date()
): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < 60_000) return t('events.just_now');
  return formatDistanceToNowStrict(date, {
    addSuffix: true,
    locale: dateFnsLocaleFor(lang),
  });
}
```

Constants: `7` (list window, in days) and `60_000` (just-now threshold, ms) are
semantic. Per rule 25 add `RELATIVE_TIME_LIST_WINDOW_DAYS` and
`RELATIVE_TIME_JUST_NOW_MS` to `lib/zmninja-ng-constants.ts` and import them here
and in `EventCard`.

## `EventCard.tsx`

The timing row (around line 218-226) is `flex flex-wrap ... gap-2 sm:gap-4`. After
the existing Time badge, append a third badge, rendered only when within the
window:

```tsx
{isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS) && (
  <div
    className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5"
    data-testid="event-relative-time"
  >
    <Hourglass className="h-3 w-3 sm:h-4 sm:w-4" />
    <span className="truncate min-w-0">{formatEventRelative(startTime, i18n.language, t)}</span>
  </div>
)}
```

`Hourglass` from `lucide-react`. `t` and `i18n` come from the existing
`useTranslation()` in the component. `truncate min-w-0` per rule 11.

## `EventDetail.tsx`

In the Timing card (around line 508-515), under the "Time" value, add a muted
second line, always shown:

```tsx
<div className="text-sm text-muted-foreground">{fmtTime(startTime)}</div>
<div className="text-xs text-muted-foreground/70" data-testid="event-detail-relative-time">
  {formatEventRelative(startTime, i18n.language, t)}
</div>
```

`i18n` from the existing `useTranslation()` in the page.

## i18n

Add `events.just_now` to all five files under `src/locales/{en,de,es,fr,zh}/translation.json`:

- en: "just now"
- de: "gerade eben"
- es: "ahora mismo"
- fr: "à l'instant"
- zh: "刚刚"

`formatDistanceToNowStrict` supplies the "N units ago" strings from its own locale
data, so no other keys are needed.

## Testing

**Unit — `lib/__tests__/relative-time.test.ts`** (new):
- `isWithinDays`: inside window (1 min, 6 days) true; outside (8 days) false;
  future date (negative diff) false; boundary at exactly 7 days true.
- `formatEventRelative` with a fixed `now`: < 60s returns the just-now key
  (mocked `t` returns the key); 40 min, 3 hr, 2 days produce a single-unit "ago"
  string; passing `lang: 'es'`/`'de'`/`'fr'`/`'zh'` produces the localized suffix
  (assert on locale-specific output, e.g. "hace", "vor", "il y a", "前").
- `dateFnsLocaleFor`: "en-US" and "en" resolve to enUS; "zh" to zhCN; unknown
  falls back to enUS.

**Unit — `EventCard.test.tsx`** (update): with an event started minutes ago,
`event-relative-time` is present; with an event started > 7 days ago, it is absent.

**E2E — `events` feature**: recent event in the list shows a relative chip
(`event-relative-time`) alongside the absolute time. Gate with the conditional
pattern if no recent event is guaranteed on the test server.

## Docs

Update `docs/developer-guide/12-shared-services-and-components.rst` with the
`relative-time.ts` helper (functions, the just-now threshold, the 7-day list
window, and the language-to-locale map). Note in the user guide's events section
that recent events show how long ago they occurred.

## Out of scope

- Migrating `NotificationHistory` to `dateFnsLocaleFor` (it can adopt the map
  later; not part of this change).
- Live-ticking updates (explicitly chosen static).
- A user setting to toggle the feature.
