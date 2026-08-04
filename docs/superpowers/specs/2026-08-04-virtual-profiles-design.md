# Virtual profiles design

Approved by the maintainer 2026-08-04: "All Profiles" generalizes to
named virtual profiles. A virtual profile is a named group of existing
real profiles that behaves exactly like today's All Servers mode, scoped
to its members. All Servers becomes the built-in virtual profile. Flat
membership only: a virtual profile can contain real profiles, never
other virtual profiles (any nested combination flattens to a member
list, so nothing is lost). Settings buckets are fully independent per
virtual profile; there is no inheritance from the All bucket (the
settings store cannot represent an unset key: the first write of any
key seeds the whole bucket with defaults, see the seeding-trap note in
developer-guide 12).

The audit this spec builds on inventoried 54 non-test sites that assume
one aggregate id, in five classes (scope-derived, predicate,
write-target, literal, guard). The audit tables travel in the plan
documents; this spec records the decisions.

## Decisions

1. **Id shape: prefixed.** Virtual ids are
   `VIRTUAL_PROFILE_ID_PREFIX + crypto.randomUUID()` with the prefix
   `__virtual_`. `isVirtualProfileId(id)` is a pure string test and
   `isAggregateProfileId(id)` is `id === ALL_PROFILES_ID ||
   isVirtualProfileId(id)`. Both helpers live in `api/types.ts` beside
   the brand and the existing sentinels; the sentinel-locality gate in
   `agents-contracts.test.ts` extends to cover the prefix the same way.
   Rationale: service modules (`pushNotifications`, `notifications`
   store) compare ids without store access; a string-shape predicate
   collapses the predicate and guard classes to mechanical edits. A
   plain UUID would force a new gate into four or more service modules.
2. **ALL keeps its magic string.** `ALL_PROFILES_ID` is unchanged for
   persistence continuity; every existing test and stored bucket stays
   valid. All Servers is presented as the built-in virtual profile but
   is not stored in the new slice; it remains implicit (membership =
   all enabled profiles).
3. **Scope mode widens `'all'`; no third mode value.** All 17
   mode-consuming sites ask "am I aggregating" and none care which
   aggregate. The `'all'` arm gains `aggregateId: ProfileId` and
   `aggregateName: string | null` (null = All Servers; consumers use
   the localized name). No consumer switches exhaustively on mode, and
   there are zero `mode === 'single'` comparisons in app code.
4. **Storage: new slice on the profile store.**
   `virtualProfiles: VirtualProfile[]` where
   `VirtualProfile = { id: ProfileId; name: string;
   memberProfileIds: ProfileId[] }`. Purely additive to the persisted
   blob; every read defends with `?? []` (store has no version field;
   adding one is out of scope). Members are real profile ids only;
   the dialog cannot offer virtual entries.
5. **Membership hygiene: prune on write, filter on read.**
   `deleteProfile` removes the deleted id from every
   `memberProfileIds`; scope resolution additionally filters unknown
   and disabled ids (defense against hand-edited storage).
   `deleteAllProfiles` clears the slice. A virtual profile whose
   effective member list is empty collapses scope to null exactly like
   All mode with zero enabled profiles (routes to setup/profiles).
   Deleting a virtual profile that is current resets
   `currentProfileId` to null (closing for virtual ids the gap that
   exists today for ALL). Minimum membership: one; the dialog rejects
   an empty selection.
6. **Name uniqueness spans both namespaces.** A virtual profile may
   not share a name with a real profile or another virtual profile
   (case-insensitive trim, matching the existing
   `validateNameAvailability` semantics, which gains the second list).
   Rationale: the switcher and notification attribution
   (`findProfileByName`) present names from both namespaces.
7. **lastUsed is not written for aggregate switches** (existing ALL
   behavior, kept identical for virtual ids).
8. **Reconciliation covers every aggregate bucket.**
   `useReconcileDeletedMonitors` prunes composite
   `profileId:monitorId` ids from the ALL bucket today; it loops over
   the ALL bucket plus every virtual profile's bucket.
9. **Guards extend via the predicate.** The eight guard sites from the
   audit (sessions registry, tryGetCurrentSession,
   profile-initialization rehydrate, notification-profile cross-switch
   prompt, notifications store display gate, three pushNotifications
   sites) replace their `=== ALL_PROFILES_ID` with
   `isAggregateProfileId`. Three of these are real bugs if missed
   (spurious switch prompt, suppressed notification display, events
   stored under the virtual id); the wave-A tests pin each.
10. **Free win, do not re-fix:** `useCurrentProfile.currentProfile`
    already resolves null for any unmatched id, so every
    single-mode-only surface degrades correctly for virtual ids with
    no change. Wave B must not "fix" sites that already work through
    this path; the audit's class-(a) and already-generic class-(c)
    lists are the do-not-touch inventory.
11. **UI.** Profiles page: virtual profile cards render after the All
    Servers card in the same blue visual family, each with edit and
    delete affordances (`profile-card-virtual-<id>` testids) and the
    same resource note semantics. Create via a "New group" action near
    the All card. The form is a new
    `components/profiles/VirtualProfileDialog.tsx` (name input +
    member checkbox list; ProfileForm is server-connection-shaped and
    is not reused). The profile switcher lists virtual profiles under
    All Servers with the same >= 2-enabled-profiles gate as the All
    entry; virtual entries show their stored name. Deleting a virtual
    profile prompts for confirmation but deletes only the group and
    its settings bucket, never member profiles; the copy says so.
12. **Virtual settings buckets are deleted with the group**
    (`profileSettings[virtualId]`, dashboard widgets bucket, and any
    other per-id bucket), so orphaned buckets do not accumulate.

## Non-goals

Nesting; settings inheritance; per-virtual notification connections
(connections stay per real profile); a virtual id ever reaching the
session registry, auth store, or notification event buckets; changes
to the `/all/*` route shape (paths carry the owning member id and are
aggregate-agnostic; the audit confirmed all 15 path-building sites).

## Waves

- **A — entity + scope + guards**: types/predicates in api/types.ts
  (+ gate extension), profile-store slice + CRUD + hygiene (decisions
  4, 5, 7), useProfileScope resolution (member-filtered enabled list,
  aggregateId/aggregateName on the arm), the eight guard extensions,
  reconciliation loop (decision 8). Proven red per cluster, including
  the three real-bug guards.
- **B — generalization sweep**: the audit's predicate class (6 sites)
  to `isAggregateProfileId`/mode checks; literal class (9 sites)
  case-by-case per the audit's role notes (switchProfile branch,
  switcher/Profiles handlers and labels via aggregateName, spinner);
  write-target literals (10 sites) become "current aggregate id".
  Mutation-pinned per cluster; All-Servers and single-mode behavior
  byte-identical (existing suites are the guard).
- **C — UI + e2e + docs**: decision 11, locales x5, outcome-based e2e
  (create a group scoped to one of the two live-server profiles,
  switch, assert member-scoped aggregation, settings independence
  from the All bucket, delete restores), user + developer docs, and
  the AGENTS.project.md Aggregation-contract touch-up naming virtual
  ids (via the self-improvement protocol, within the word budget).

Each wave lands through the implementer/reviewer loop with proven-red
tests and mutation verification, refs #337.
