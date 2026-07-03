# Show Developer Notices toggle

## Problem

Users have no way to turn off developer notices. Some want them hidden entirely.

## Approach

A device-global boolean `showNotices` (default `true`) in the existing
`useDeveloperNoticeStore` (same localStorage key, not profile-scoped, matching
the device-global nature of the notice read/deleted state). A Switch in the
Advanced settings section flips it. When off, notices are hidden everywhere and
the feed fetch stops.

## Store

`stores/developerNotices.ts` gains:

- `showNotices: boolean` (initial `true`)
- `setShowNotices(value: boolean): void`

No persist migration: the default shallow merge leaves `showNotices` at `true`
for existing users (undefined in old persisted state, filled from the initializer).

## Hook

`hooks/useDeveloperNotices.ts` reads `showNotices` and:

- Passes `enabled: showNotices` to the `useQuery`, so the 24h/on-focus fetch
  stops when off.
- When `!showNotices`, returns `notices: []`, `unreadCount: 0`,
  `criticalUnread: []` (so every consumer sees nothing), and still returns the
  same shape otherwise.

Because the banner and sidebar dot derive from `criticalUnread`/`unreadCount`,
they hide automatically when off. No change to the delete/read filtering added
in the same branch; the `showNotices` gate wraps around it.

## UI

### Sidebar

`components/layout/SidebarContent.tsx`: filter out the `/developer-notice` nav
item when notices are off, so the entry (not just the unread dot) disappears.
It reads `showNotices` from `useDeveloperNoticeStore`.

### Settings toggle

`components/settings/AdvancedSection.tsx`: a `Switch` row titled
"Show Developer Notices" with a short description, reading `showNotices` and
writing `setShowNotices` from `useDeveloperNoticeStore` (device-global, so it
does not use the profile `update` helper the other rows use). `data-testid`
`settings-show-developer-notices`.

### Page reached while off

If `/developer-notice` is opened by direct URL while off, the hook returns
empty, so the page shows its existing empty state. Acceptable: the nav entry is
hidden, so this is an edge case. No dedicated message (YAGNI).

## i18n

New keys in all five locales (`en`, `de`, `es`, `fr`, `zh`), short label:

- `settings.show_developer_notices`
- `settings.show_developer_notices_desc`

## Testing

- **Store** (`stores/__tests__/developerNotices.test.ts`): `showNotices`
  defaults `true`; `setShowNotices(false)` flips it.
- **Hook** (`hooks/__tests__/useDeveloperNotices.test.ts`): with
  `showNotices: false`, `notices`/`unreadCount`/`criticalUnread` are empty even
  when the feed has entries, and the query does not run (fetch mock not called);
  with `true`, normal behavior.
- **E2E** (extend `tests/features/developer-notice.feature`, web): from the
  notices page with notices present, open Settings > Advanced, turn off
  "Show Developer Notices", and confirm the sidebar `/developer-notice` entry
  is gone; turn it back on and confirm it returns.

## Out of scope

- Per-profile control (this is device-global by design).
- Disabling push notifications (a separate feature/page).
