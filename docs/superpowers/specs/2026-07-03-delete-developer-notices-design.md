# Delete developer notices (per-device)

## Problem

The developer-notice list grows over time and there is no way for a user to
remove entries they have dealt with. Notices come from a static remote feed
(`docs/notices.json`, fetched via GitHub raw), so the app has no local notices
database to delete rows from and no write access to the feed.

## Approach

A delete is a persisted per-device exclusion. The store keeps the ids the user
deleted; `useDeveloperNotices` excludes them from the fetched feed on every
refetch. From the user's side this behaves as a real delete: the notice leaves
the list and does not return on refetch. The only way back is a global Reset
that clears the exclusion list and re-pulls the feed.

This mirrors the existing `readIds` and `dismissedBannerIds` patterns in the
same store, so there is no new persistence mechanism.

## Data model

`stores/developerNotices.ts` gains a `deletedIds: string[]` field in the same
persisted store (same localStorage key, not profile-scoped):

- `isDeleted(id: string): boolean`
- `deleteNotice(id: string): void`: append id if absent (idempotent)
- `deleteNotices(ids: string[]): void`: union bulk delete
- `restoreAllDeleted(): void`: clear `deletedIds` to `[]`

Read state and deleted state are independent: deleting does not change
read/unread, and Reset does not change read/unread.

## Hook

`hooks/useDeveloperNotices.ts` reads `deletedIds` from the store and filters
deleted ids out of the feed **before** mapping and counting. Consequences:

- Deleted notices leave `notices`, `unreadCount`, and `criticalUnread`.
- Because `criticalUnread` drives `DeveloperNoticeBanner`, deleting a critical
  notice also removes its banner. This is intended: the user has dealt with it.

The filter order is: `minAppVersion` filter, then `deletedIds` filter, then map
to `DeveloperNoticeView`, then sort. No change to the sort or read merge.

## UI (`pages/DeveloperNotice.tsx`)

### Per-row delete

Each `NoticeRow` gets a trash button next to the existing read-toggle and
chevron. One click calls `deleteNotice(notice.id)`. No per-item confirm and no
undo. `data-testid="developer-notice-delete-<id>"`, with `stopPropagation` so it
does not toggle the row.

### Action row

The action row currently holds reload, mark-all-read, and mark-all-unread.
Five inline buttons will not fit a 320px phone, so:

- **Reload** stays inline (icon only), as today.
- **Mark all read**, **Mark all unread**, **Clear all**, **Restore deleted**
  move into a kebab (overflow) menu at the end of the row, built with the
  existing `components/ui/dropdown-menu` primitive.
  - Mark all read: disabled when there are no unread.
  - Mark all unread: disabled when there are no read.
  - Clear all: destructive styling; disabled when the visible list is empty;
    calls `deleteNotices(<ids of currently-visible notices>)` after a confirm.
  - Restore deleted: disabled when `deletedIds.length === 0`; calls
    `restoreAllDeleted()` then `refetch()`.

Kebab trigger: `data-testid="developer-notice-actions-menu"`. Item testids:
`developer-notice-clear-all`, `developer-notice-restore-deleted`, plus the
existing `developer-notice-mark-all-read` / `-mark-all-unread` moved onto the
menu items.

### Clear all confirm

Clear all opens an `AlertDialog` (existing `components/ui/alert-dialog`):
title asks to delete all N visible notices, body notes Restore brings them back,
confirm button is destructive. Per-row delete has no dialog.

### Empty-list reachability

Today the action row and list only render when `notices.length > 0`. After Clear
all the list is empty and the row would vanish, stranding Reset. Fix:

- Render the action row when `notices.length > 0 || deletedIds.length > 0`.
- The empty-state card shows a **Restore deleted notices** button when
  `deletedIds.length > 0`, in addition to the existing empty-state text.

So there is always a path back to the deleted notices.

## i18n

New keys in all five locales (`en`, `de`, `es`, `fr`, `zh`), short enough to fit
a 320px screen:

- `developer_notice.delete`: trash button title/aria
- `developer_notice.more_actions`: kebab aria label
- `developer_notice.clear_all`
- `developer_notice.clear_all_confirm_title`
- `developer_notice.clear_all_confirm_body`: takes a `{{count}}`
- `developer_notice.restore_deleted`

Reuse `common.cancel` and `common.delete` if present; add them only if missing.

## Testing

- **Store** (`stores/__tests__/developerNotices.test.ts`): `deleteNotice` appends
  and is idempotent, `isDeleted` reflects it, `deleteNotices` unions, and
  `restoreAllDeleted` clears. Deleted state does not touch `readIds`.
- **Hook** (`hooks/__tests__/useDeveloperNotices.test.ts`): deleted ids are
  absent from `notices`, `unreadCount`, and `criticalUnread`.
- **E2E**: new `tests/features/developer-notice.feature` (web tag) with steps
  in `tests/steps/developer-notice.steps.ts`; there is no notice e2e today.
  Delete one row and confirm it is gone; Clear all empties the list and leaves
  Restore reachable; Restore brings the notices back. Needs a stubbed feed
  (the DEV build already serves `/__dev-notices.json`, per `api/developer-notices.ts`).

## Out of scope

- Editing or pruning the shared `docs/notices.json` feed (a maintainer action).
- Per-item undo or a "recently deleted" view. Reset is the only recovery.
- Syncing deleted state across devices.
