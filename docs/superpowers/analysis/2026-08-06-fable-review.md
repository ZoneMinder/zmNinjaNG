# Fable codebase review, 2026-08-06

Reviewer: Claude (Fable 5), orchestrating eleven Fable pillar agents, each
read-only with a fresh context. Every finding below was confirmed by the
orchestrator re-reading the cited source before publication; findings the
orchestrator could not confirm were dropped, not softened.

Scope: `app/src` (453 production files, 78,247 lines; 344 unit-test files,
69,533 lines), `app/tests` e2e (60 files, 8,152 lines), native shells
(iOS Swift 1,822 lines, Android 1,643 lines, Electron 344 lines), `docs/`
(75 files), 16 GitHub workflows, hooks, and both package manifests.

Excluded: `node_modules`, generated output (`docs/_build`, `dist`), locale
file content beyond parity checks, and the Tauri remnants (only their
gitignore state was examined).

Skipped by instruction: Pillar 12 (Security) was offered to the maintainer
and declined for this run. It is recorded as not assessed, not zero.
Security-adjacent defects that surfaced through other pillars (native TLS
behavior, token handling) are reported under those pillars.

Repository state at review time: branch `main`, clean working tree, HEAD
`15be710c`.

## Scorecard

| Pillar | Score | Verdict |
|---|---|---|
| 1. Code clarity | 8.3 | Top-decile why-comments and idiom uniformity; a 9-file indentation fork, one hand-rolled fetch with a staleness race |
| 2. DRY and reuse | 7.4 | Shared primitives genuinely adopted; four block-level copies held together by comments, two already drifted user-visibly |
| 3. Contract and rule adherence | 8.1 | Measured near-zero violations where gates exist; ten Gate lines promise mechanization that does not exist |
| 4. Architecture and modularity | 7.9 | Static graph verified acyclic, sessions mechanized; one direct Never-clause breach, gate labels overstate coverage |
| 5. Test quality and automation trust | 7.0 | Strong unit tier; confirmed conditional-pass e2e chains on a core journey, and the step gate checks presence, not reachability |
| 6. Runtime performance | 8.3 | Hard optimization work done and documented; one closure voids the montage memo barrier, per-frame pinch re-renders |
| 7. Native platform integration | 7.8 | Well-reasoned native code; one confirmed iOS hang class, one Android TLS pin bypass beyond the documented relaxations |
| 8. Accessibility and UX robustness | 8.1 | Blocking a11y gate, 84/84 named icon buttons; two themes fail AA contrast, alarms invisible under reduced motion |
| 9. Build, CI, dependency health | 7.9 | Branch protection and ratchet design verified; e2e job green while never executing, no-op lint-staged hook, 22 known vulnerabilities |
| 10. Documentation and handover | 7.4 | 19 of 24 spot-checked claims exact; four chapters still teach the retired HTTP singleton the contract gate forbids |
| 11. Error handling and trust boundaries | 8.8 | Systematic schema tolerance and destructive-path recovery; one unvalidated API module whose caller fails silently |
| 12. Security | not assessed | Skipped by maintainer instruction for this run |

**Overall: 7.9 / 10** (mean of the eleven assessed pillars).

## Gates

All gates were run bare from `app/`, exit codes checked directly.

| Command | Result | Raw counts |
|---|---|---|
| `vitest run` | pass | `Test Files 343 passed | 1 skipped (344)`, `Tests 4059 passed | 2 skipped (4061)` |
| `npm run build` (`tsc -b && vite build`) | pass | chunk-size warnings only |
| `npm run lint:a11y` | pass | 0 problems |
| `npm run lint:correctness` | pass | 0 problems |
| `npm run lint:ratchet` | pass | `Lint backlog within baseline: 202 problems across 12 rules.` |

Supplementary probes: `npx madge --circular` reports 4 cycles, all traced
to sanctioned `await import()` breaks (see Non-findings). `npm audit` in
`app/`: `22 vulnerabilities (1 low, 9 moderate, 11 high, 1 critical)`.
Live CI run 31095541802: job `e2e-tests` concluded `success` with the
`Run E2E tests` step `skipped`.

## Cross-cutting themes

These four themes account for most of the lost points across pillars.

### Ungated rules drifted; gated rules held

AGENTS.md M1 records that an earlier audit found every ungated rule
violated while every gated rule held. This review reproduces that result.
Where mechanized gates exist, discipline is measured near-perfect: zero
raw fetches, one sanctioned console call in 453 files, zero inline query
keys, zero `getState()` mutations, sessions fully clean. Where a rule is
script-checkable but ungated, it drifted every time: 43 fixed e2e sleeps
against an explicit playbook ban (P5-4), 52 files over the C2 size
guidance with no `max-lines` rule anywhere (P4-4, P3-6), a nine-file
indentation fork with no formatter config (P1-4), a pre-commit
`npx lint-staged` that has no configuration and lints nothing (P9-2), and
the native-logging rule the native playbook itself flags as ungated.
The fix pattern is uniform: ratchet-style gates seeded with current
counts, never mass rewrites.

### Green signals that overstate what ran

The e2e CI job has shown success on every run while never executing a
test, because the required server secrets are absent (P9-1). The unit-side
step gate checks that every Then step contains an assertion but not that
the assertion is reachable, so steps that guard themselves with visibility
checks pass it while being skippable to a no-op (P5-5), and three
confirmed conditional-pass chains sit on the profile-creation journey
(P5-1). Ten contract Gate lines name `agents-contracts.test.ts` for Never
clauses that file does not assert (P3-1, P4-3); the one contract that says
"Gate: review; mechanizing these is a tracked follow-up" (Aggregation) is
the honest template the others should follow or exceed.

### Drift between code and its own record

Four developer-guide chapters still teach the retired API-client singleton
whose symbols the contract test explicitly forbids (P10-1), and two call
flows assert a query-gating design that was deliberately reversed for the
all-profiles work (P10-2). The domain playbook's CI-runner entry describes
a qemu/Node-18 setup that no longer exists, and it misled this review's
own dispatch briefs (P9-4). The Auth contract's "tokens in URL query
strings" clause overreaches the incident it came from and, read literally,
forbids protocol-required stream URLs (P3-5). Two components bypass the
settings merge with duplicated inline defaults (P3-3), and one selector
calls the object-minting getter the store's own comment works around
(P6-3, P3-4). Each is small; together they erode the property the
instruction system depends on, that the written contract can be trusted
over rediscovery.

### Native edge cases beyond the documented relaxations

The TLS trust-on-first-use design records its deliberate relaxations
(accept-any-cert before a fingerprint exists, trust global across
profiles). Two behaviors fall outside that record: the iOS certificate
fetch never settles when no TLS challenge occurs, hanging profile
bootstrap and save flows (P7-1), and the Android trust path accepts any
CA-valid certificate for any hostname on a pinned host while self-signed
mode is on, which defeats the pin against an active interceptor (P7-2).
Both are confirmed from source and both require device passes to verify
fixes; no CI gate compiles or exercises native TLS.

## Pillar 1: code clarity (8.3/10)

### Strengths verified

- Why-comments carry incidents at the code site: `useStreamLifecycle.ts`
  documents every teardown path including a deliberately unreachable
  branch and the `isConnected` unmount guard with the three React
  behaviors it defends; `AskPanel.tsx` cites measured numbers (refs #261).
- Zero TODO/FIXME/HACK in production code; deferred work is 12 `ponytail:`
  markers per the convention.
- Nested ternaries rare and parenthesized; named-selector store idiom
  uniform in every file read.

### Findings

**P1-1 (LOW, confirmed).** `QRScanner.tsx:428`, load-from-file `Button`:
`variant={isNative ? 'outline' : 'outline'}` is a dead ternary, both arms
identical. A reader hunts for a platform difference that is not there.
Fix: `variant="outline"`, matching the sibling at `QRScanner.tsx:448`.
Verification: `npm run build` plus existing QRScanner tests (gate-covered
cosmetic change, no new test). Effort S (1 site). Risk none,
CI-verifiable. Contracts: C2.

**P1-2 (LOW, confirmed).** `TimelineToolbar.tsx:115-132`: component
`HelpRow` is defined inside a JSX IIFE, so a new component identity is
created each render, remounting the popover help rows. Impact cosmetic
(static text) but the canonical component-in-render anti-pattern. Fix:
hoist `HelpRow` to module scope; `LogCodeBlock` in `pages/Logs.tsx:43` is
the in-repo shape. Verification: `npm run gates`. Effort S (1 site). Risk
none, CI-verifiable.

**P1-3 (LOW, confirmed).** Six sites re-implement the same
`getEventCauseIcon(cause)` icon-plus-label block, three as JSX IIFEs:
`NotificationHandler.tsx:242`, `EventCard.tsx:272`,
`EventsWidget.tsx:189`, `NotificationHistoryItem.tsx:151`,
`useNotificationAllModeToasts.tsx:82`, `EventMontageView.tsx:235`.
`EventDetail.tsx:395-397` already shows the sanctioned `useMemo` idiom.
Fix: extract an `EventCauseBadge`/`EventCauseLabel` in
`components/events/` (C5), or hoist per-site as EventDetail does.
Verification: `npm run gates`; existing cause-text assertions cover the
extraction. Effort M (6 sites, styling varies per site). Risk: subtle
styling drift, CI-verifiable. Contracts: C1, C5.

**P1-4 (MED, confirmed).** Nine files use 4-space indentation in a
2-space codebase, and no `.prettierrc` or `.editorconfig` exists to
settle it: `pages/Logs.tsx`, `pages/Dashboard.tsx`,
`contexts/PipContext.tsx`, `components/theme-provider.tsx`, the four
`components/dashboard/*.tsx` files, and
`components/dashboard/widgets/MonitorWidget.tsx`. Cross-cutting diffs
produce noisy reviews and agents told to match existing style receive
contradictory signals. Fix: one mechanical whitespace-only `chore:`
reformat of the nine files to the majority 2-space style, plus a
formatter config so the rule is gated (M1). Verification:
`npm run gates`; `git diff -w` empty for the reformat commit. Effort M
(9 files, but the commit must stay isolated per P5). Risk: blame churn,
CI-verifiable. Contracts: M1, P5.

**P1-5 (MED, confirmed defect shape; race not yet observed).**
`pages/Logs.tsx:104-137`: the ZM server-log fetch is the only server
fetch in the app done through raw `useEffect` plus `useState` instead of
React Query. The effect has no cancellation or staleness guard, so
switching the picked profile while a fetch is in flight lets the old
profile's response land in `zmLogs` after the new request started; in All
mode a user can briefly read one server's logs attributed to another.
Also no caching, no retry, and a hand-rolled loading branch. Fix:
`useQuery` keyed via `query-keys.ts` with `asProfileId`, loading and
error UI through the shared query-state components. Verification: new
unit test proven red pre-fix (resolve profile A's fetch after switching
to B, assert B's logs render), then `npm run gates`. Effort M (1 page,
touches the loading/empty/error branches near `Logs.tsx:577`). Risk:
refetch cadence changes, CI-verifiable. Contracts: Server queries, Query
UI states, C1.

**P1-6 (LOW, confirmed pattern; failure theoretical, dev-mode).**
`useTimelineViewport.ts:96-126`, `animateToRange`: the updater passed to
`setRangeState` starts a `requestAnimationFrame` loop and returns `prev`.
Updaters must be pure; StrictMode double-invocation schedules two easing
loops that fight over `animFrameRef`. Fix: start the loop outside the
updater, reading the current range from the closure or a ref.
Verification: unit test invoking the updater twice with mocked rAF,
proven red pre-fix. Effort S (1 site). Risk: one skipped frame on a
concurrent pan, CI-verifiable.

**P1-7 (LOW, confirmed).** The token-freshness expression
`isFresh ? accessToken ?? undefined : undefined` is re-typed at 7 exact
sites, and the nested owner-token variant is copy-paste identical in
`EventListView.tsx:91` and `EventMontageView.tsx:115`. The expression
encodes a real auth rule with no name. Fix: one helper beside the auth
store's existing freshness selector, replacing the 8 mechanical sites;
leave the 11 near-miss variants (they differ semantically). Verification:
`npm run gates`; auth store tests already cover freshness. Effort M
(8 sites). Risk none if `?? undefined` is preserved, CI-verifiable.
Contracts: C1; Auth tokens in spirit.

**P1-8 (MED, confirmed).** Scrubber accent color `#00a8ff` is a bare hex
literal in three modules: `TimelineToolbar.tsx:126` (legend swatch that
exists only to match the others), `TimelineCanvas.tsx:294`
(`ctx.strokeStyle`), `TimelineScrubber.tsx:450`. Change one and the help
legend lies. The Constants gate passed while this drifted, so the gate is
blind to inline colors; that mismatch routes to the self-improvement
protocol. Fix: a named constant in `lib/zmninja-ng-constants.ts`,
imported at all three sites; extend or honestly annotate the constants
gate. Verification: `npm run gates`. Effort S (3 sites). Risk none,
CI-verifiable. Contracts: C4, Constants, M1/M2.

### Path to 10/10

Worth it: P1-4 (formatter config plus one reformat commit), P1-5 (the
one user-visible defect here), P1-8, and the two one-liners P1-1/P1-2.

Not worth it: rewriting `useStreamLifecycle` into a named state machine
(every branch maps to a documented incident; refactor risk is the exact
recurring regression class); collapsing `LiveMonitorPlayer`'s four
watchdog refs (fenced by a header comment, device-only verification);
deduplicating the 11 near-miss token ternaries (they differ semantically);
a blanket no-IIFE-in-JSX lint (two of eight sites are fine early-return
guards).

## Pillar 2: DRY and reuse (7.4/10)

### Strengths verified

- `ErrorBanner` plus `resolveQueryError` imported by 13 files;
  `EmptyState` at 8 call sites; `PageContainer`, `RefreshButton`,
  `GridColumnsMenu` in `components/common/` genuinely used.
- Zero duplicated pure helpers: every `format*` function is defined
  exactly once, date and time rendering routed per contract.
- Scoped fan-out hooks follow the sanctioned `useQueries` plus `combine`
  template with domain-specific bodies, not copy-paste.

### Findings

**P2-1 (MED, confirmed).** The per-profile error-strip block (row div,
`profile-error-strip-${id}` testid, `ErrorBanner` with
profile-name-prefixed `resolveQueryError` message, outline Retry button
with its own testid) is byte-near-identical in four places:
`pages/Monitors.tsx:409-434`, `pages/Timeline.tsx:412-436`,
`components/events/EventsAllModeBar.tsx:52-75`, and `MontageErrorStrips`
in `components/montage/MontageGridSections.tsx:51-79`, whose own comment
admits it "deliberately mirrors Monitors.tsx". The zero-data suppression
predicate is likewise repeated in four pages. Drift has shipped: Monitors
has a single-profile unprefixed message variant the other three lack.
Fix: `ProfileErrorStrips` in `components/common/` keeping the exact
testid strings; the four render sites become one element each.
Verification: existing all-mode e2e keys on those testids; `npm run
gates`. Effort M (4 render sites plus 4 predicate sites). Risk: testid or
message-join regression, CI-verifiable. Contracts: C1; Query UI states
(duplication above the contract, not a bypass).

**P2-2 (MED, confirmed).** All-mode deep-route templates
(`/all/events/${profileId}/${id}` and the `/monitors` twin) are hand
built inline at 15 sites across pages, widgets, cards, palette, and
hooks, while `lib/navigation.ts:51` holds the canonical copy without
exporting a helper. These are the deep links whose bare-id class produced
six prior all-profiles defects (domain playbook). Fix: export
`eventPath(id, profileId?)` and `monitorPath(id, profileId?)` from
`lib/navigation.ts`; replace the 15 inline templates; each site keeps its
own `navigate` state payload. Verification: existing navigation e2e plus
one unit assert on the helper's two branches; pure refactor otherwise
covered by existing gates. Effort M (15 sites, one line each). Risk:
missed per-site state payloads, CI-verifiable. Contracts: C1, C4,
Aggregation.

**P2-3 (LOW, confirmed).** Three native-LLM capability probe hooks are
structurally identical for about 78 lines each
(`useNativeLlmSupported.ts`, `useAppleIntelligenceSupported.ts`,
`useGeminiNanoSupported.ts`); differences are the plugin path, mock key,
reason union, and Gemini's refresh counter. Fix: one probe factory; the
three hooks become thin typed wrappers keeping their public names and
mock seams. Verification: the three hooks' existing unit tests unchanged;
`npm run gates`. Effort S. Risk: e2e mock-seam semantics, covered by
assistant e2e. Contracts: C1, Native (dynamic import stays inside the
factory).

**P2-4 (LOW, confirmed).** The page-header title block is hand-copied
across roughly 10 pages and has drifted: `DeveloperNotice.tsx:172` uses a
different type scale and weight, `NotificationSettings.tsx:355` a
different subtitle recipe. Fix: `PageHeader` beside `PageContainer`,
carrying an always-visible-subtitle prop because Monitors deliberately
keeps its live count on phones. Verification: cosmetic, existing gates.
Effort M (10 sites, 6-line swaps). Risk: header row layouts differ; the
component owns only the title cluster. Contracts: C1.

**P2-5 (LOW, confirmed).** `formatElapsedShort`
(`lib/format-date-time.ts:116`) exists, yet three components re-implement
duration formatting (`EventProgressBar.tsx:47`, `CompactEventRow.tsx:57`,
`EventPreviewPopover.tsx:51`), and the popover renders "4m 7s" where the
rows render "4:07" for the same datum; events over an hour render without
an hours field in CompactEventRow. Fix: use the helper at all three
sites; if the sub-minute "42s" form is wanted, add it as one branch in
the helper. Verification: helper's test file gains the new branch assert
(red first); component swaps ride existing gates. Effort S (3 sites).
Contracts: C1, Date and time.

**P2-6 (LOW, confirmed).** Six destructive-confirm AlertDialogs
re-compose the same Title/Description/Cancel/Action block, and the
destructive class string
`bg-destructive text-destructive-foreground hover:bg-destructive/90` is
pasted verbatim at six sites instead of
`buttonVariants({ variant: 'destructive' })`; `DeleteBatchBar.tsx:42`
pastes it on a plain Button that could say `variant="destructive"`.
Drift shipped: `Logs.tsx:546` leaves its clear-logs confirm
default-styled. Fix (minimal form): six one-line `buttonVariants` swaps
plus the DeleteBatchBar variant; a shared ConfirmDialog only if a seventh
site appears. Verification: delete/clear e2e testids unchanged;
`npm run gates`. Effort S. Risk: Logs' action becomes destructive-styled,
which is the intended fix. Contracts: C1, C4.

**P2-7 (LOW, confirmed).** The list-page loading skeleton plus the
`stillWaiting` guard (with its three re-explained refs #337 comments) is
triplicated in Monitors, Montage, and Events, and the skeleton wrappers
hardcode `p-8` while loaded states render in `PageContainer` padding, so
phones visibly re-pad on load. The Query UI states contract names shared
skeletons as the sanctioned home; these predate it. Fix:
`ListPageSkeleton` beside `DetailPageSkeleton` in
`components/ui/query-state.tsx`, wrapped in `PageContainer`; note the
contract gap in the PR. Verification: cosmetic, existing gates. Effort S
(3 sites). Risk: Events' variant fills height; needs the variant prop.
Contracts: C1, Query UI states.

### Path to 10/10

Worth it: P2-1, P2-2 (the two copies guarding user-facing behavior with
shipped drift and the worst defect-history subsystem), P2-6 minimal form,
P2-5.

Not worth it: a generic page framework (pages differ legitimately;
speculative flexibility); merging the scoped fan-out hooks behind an
abstraction (the per-hook template is the sanctioned design); a full
ConfirmDialog migration for six stable sites; extracting the one-line
`stillWaiting` predicate.

## Pillar 3: contract and rule adherence (8.1/10)

### Strengths verified (measured, not sampled)

- HTTP: 0 violations in 453 production files (the one real `fetch()` is
  inside the sanctioned adapter).
- Logging: 1 console call, the documented anti-recursion escape in
  `lib/log-file/capacitor.ts:56`.
- Sessions: fully mechanized (construction sites, deleted singleton,
  sentinels, auth-to-sessions direction) and clean.
- Server queries: 0 inline `queryKey` arrays. Stores: 0 `getState()`
  mutations, 0 whole-store subscriptions found.
- Native: all Capacitor plugin imports dynamic; mobile downloads base64
  without Blob conversion, as the contract sanctions.
- Aggregation: all 6 `ALL_PROFILES_ID` references inside the allowed
  arms; sampled `getCurrentSession` consumers aggregate-guarded.
- Localization: dual-gated (key existence plus placeholder parity with a
  1000-key floor).

### Findings

**P3-1 (MED).** Ten contracts' Gate lines name
`app/src/tests/agents-contracts.test.ts` for Never clauses that file
never asserts (Settings, Polling, HTTP, Logging, Server queries, Stores,
Query UI states, Date and time, the hardcoded-string half of
Localization, Native, Constants). The file mechanizes contract format,
symbol existence, doc style, Sessions, and locale placeholders only; no
console, raw-fetch, inline-queryKey, date-pattern, or static-plugin-import
check exists there or in any lint config. This is M2 in action: a green
gate is read as proof a Never clause held when it proves only that the
contract prose parses. P3-2 is the live demonstration. Fix: mechanize the
cheap greps (console, fetch/axios, static plugin imports, date-fns
literals) using the Sessions block as the template, about 10 lines each,
and reword the remaining Gate lines to the honest Aggregation form. Route
through the self-improvement protocol (M3). Verification: each new
assertion proven red with a scratch violation before landing (P2), then
green on main. Effort M. Risk: comment false positives in greps,
CI-verifiable. Contracts: M1, M2, M4, plus the ten named. Same defect
family as P4-3; execute once.

**P3-2 (MED, confirmed).** Same finding as P4-1 (see Pillar 4);
`services/download.ts:23` statically imports a store against the Service
boundary Never clause, and the named gate checks cycles only. One fix,
counted once in the plan.

**P3-3 (MED, confirmed).** Two components bypass `mergeProfileSettings`
with duplicated inline defaults, the exact reactive-bypass class the
Settings Never clause names. `components/theme-provider.tsx:48` selects
the raw theme and falls back to a `defaultTheme` of `'slate'` duplicated
from `stores/settings.ts:381`; `LiveMonitorPlayer.tsx:186-189` selects
raw settings and applies `?? 'auto'` duplicating `settings.ts:441`, plus
a raw `monitorStreamingOverrides` read. The sanctioned reactive template
(raw select, then `mergeProfileSettings` in `useMemo`) is three files
over in `useCurrentProfile.ts:83`. The next merge-level default or
coercion change silently never reaches these two paths. Fix: apply the
template at both sites, delete the inline defaults. Verification: unit
test asserting a merge-level default change reaches the component,
proven red pre-fix; settings and player suites stay green. Effort S
(2 files, 3 read sites). Risk: none if the merge stays outside the
selector (the theme-provider comment explains the loop hazard),
CI-verifiable. Contracts: Settings, Stores.

**P3-4 (LOW, confirmed as contract-letter violation).** Same site as
P6-3 (see Pillar 6): `MontageMonitor.tsx:153-155` calls the
object-minting `getProfileSettings` inside a `useShallow` selector. One
fix, counted once.

**P3-5 (LOW, confirmed code/contract mismatch; code is correct).** The
Auth contract's Never clause "tokens in URL query strings" contradicts
protocol-required behavior: streams and frame images load via `img` and
`video` elements that cannot send headers, so access tokens ride the
query string by design (`lib/zm/url-builder.ts:271`,
`api/events.ts:460`, `services/discovery.ts:222`), and the log sanitizer
redacts them. The incident behind the clause was a refresh token leaking
(domain playbook, e1393724). Fix via the self-improvement protocol:
narrow the clause to refresh tokens, with access tokens permitted only
where the protocol requires them. Verification: contract-format and
word-budget tests stay green. Effort S. Contracts: Auth tokens, M3.

**P3-6 (LOW, confirmed).** C2 (files near 400 lines) is ungated; 52
production files exceed 400 lines, 14 exceed 700, with no `max-lines`
rule in any config and no ratchet entry. Fix: add `max-lines` to the
ratchet so the count can shrink but not grow; do not mass-split (see Not
worth it). Verification: `npm run lint:ratchet` red on growth past
baseline. Effort S for the gate. Contracts: C2, C7, M1. Same finding as
P4-4; execute once.

**P3-7 (LOW, confirmed).** Four gate files cite retired numeric rule IDs
in comments (`no-em-dash.test.ts` "rule 1", `no-circular-deps.test.ts`
"rule 28", `e2e-steps.test.ts` "rules 6 and 12",
`dependency-classification.test.ts` "rule 37"); AGENTS.md now uses tiered
IDs, so a failing gate prints a reference the contributor cannot follow.
The rule-ID validity scan only covers `docs/developer-guide/*.rst`. Fix:
update the 7 comment sites; optionally extend the scan to
`src/tests/*.ts`. Effort S. Contracts: M4.

**P3-8 (LOW).** Six inline timer literals where the Constants contract
implies a name belongs (`AskPanel.tsx:148,360`,
`AssistantOllamaSection.tsx:129`, `LiveActivity.tsx:255`,
`QRScanner.tsx:166`, `pushNotifications.ts:313`). These are UI ticks,
not bandwidth values; either name them beside the existing groups or add
a one-line UI-tick exception to the contract via the protocol. Doing both
is churn; pick one. Effort S. Contracts: Constants, C4.

### Path to 10/10

Worth it: P3-2 with its direction gate; P3-3 and P3-4 onto the sanctioned
template; the cheap half of P3-1 plus honest rewording of the rest; P3-5
and P3-7 text corrections; the P3-6 ratchet entry.

Not worth it: splitting the 14 over-length files now (the constants file
is large because the contract funnels values there; ratchet the growth,
split opportunistically); mechanizing the Aggregation, Query-UI-states,
and hardcoded-string clauses (each needs semantic judgment a grep would
fake; M2 says a wrong-input gate is worse than honest review); renaming
the six UI ticks if the contract-exception route is chosen instead.

## Pillar 4: architecture and modularity (7.9/10)

### Strengths verified

- The cycle gate walks static imports including type-only ones, stricter
  than tsc; all four madge-reported cycles traced edge by edge to
  sanctioned `await import()` breaks. The static graph is acyclic.
- Query-key discipline clean repo-wide; `lib/query/` well-shaped.
- Auth persistence partitions refresh tokens into secure storage with
  drop-not-plaintext failure handling, matching the contract exactly.
- Persistence migrations versioned where shape changed; cycle-breaking is
  a designed, commented pattern (gate injection, deliberate leaf modules).

### Findings

**P4-1 (MED, confirmed).** `services/download.ts:23` statically imports
`useBackgroundTasks` from `stores/backgroundTasks` (used via `getState()`
at lines 401, 429, 431), a direct breach of the Service boundary Never
clause. Every other service uses dynamic imports or injected gates. The
named gate (`no-circular-deps.test.ts`) checks cycles, not direction, so
it passed; one future import from `backgroundTasks` toward services
closes a real cycle. Fix: gate injection
(`setPushServiceStoreGates` in `services/pushNotifications.ts:27` is the
template) or the dynamic-import pattern
(`services/profile-bootstrap.ts:188`), then add a services-to-stores
static-import direction assertion beside the existing auth-to-sessions
check, proven red against pre-fix `download.ts`. Verification: new
assertion red then green; `npm run gates`. Effort S (1 import, 3 call
sites, 1 test). Risk: dynamic-import variant makes call sites async; gate
injection avoids that. CI-verifiable. Contracts: Service boundary, P2,
M1, M2.

**P4-2 (LOW, confirmed).** `services/pushNotifications.ts:24` reaches
`stores/profile` statically through
`lib/profile/notification-profile.ts`, while its own header explains why
stores are gate-injected. The chain
stores/notifications to services/pushNotifications to the lib helper to
stores/profile is live at build time; only the dynamic
profile-to-notifications edge keeps it from being a cycle. Fix: pass the
profile list as a parameter or move resolution behind the existing gate
injection; extend the P4-1 direction walk to transitive paths if cheap.
Effort S (3 sites). Contracts: Service boundary, Notifications.

**P4-3 (MED, confirmed).** Same defect family as P3-1 (Gate lines
promising unmechanized enforcement); see Pillar 3. Counted once.

**P4-4 (LOW, confirmed).** Same as P3-6 (C2 ungated; 52 files over 400
lines; largest: `lib/zmninja-ng-constants.ts` 1347,
`AskPanel.tsx` 911, `api/types.ts` 890, `stores/notifications.ts` 838,
`stores/profile.ts` 829). Counted once.

**P4-5 (LOW, confirmed).** `contexts/` holds exactly one file
(`PipContext.tsx`), against C5; `assets/react.svg` is the Vite template
leftover, referenced nowhere. Fix: move PipContext into a domain folder
(3 imports), delete the dead asset. Effort S. Contracts: C5, C2.

**P4-6 (MED impact, theoretical; ranks below all confirmed findings).**
Every persisted store except auth uses zustand's default localStorage,
including `stores/profile.ts:692`, the app's root user data. iOS
documents WebKit website data as evictable under storage pressure;
eviction would drop every configured server while their passwords
survive orphaned in the Keychain. No field report exists in the playbook
or issues; labeled theoretical. Fix: a `PersistStorage` adapter over
Capacitor Preferences for the profile store on native (the auth adapter
at `stores/auth.ts:122` is the in-repo template), with a one-time
rehydrate migration; settings second; the rest are recoverable caches.
Verification: unit test on adapter and migration (red first via the
Preferences read path); durability itself is device-only. Effort M.
Risk: async rehydration timing where localStorage was sync; the
`onRehydrateStorage` hang guard is the thing to test. Contracts: I2,
Settings, Native.

### Path to 10/10

Worth it: P4-1 with the direction assertion; the cheap half of P4-3;
the P4-4 ratchet line; P4-6 for the profile store only.

Not worth it: splitting the 52 oversized files for literal C2 compliance;
converting the remaining persisted stores to Preferences (eviction costs
a re-fetch, not data); replacing dynamic-import cycle breaks with a DI
framework or event bus (speculative architecture); chasing madge parity
(the four reports are the sanctioned pattern working).

## Pillar 5: test quality and automation trust (7.0/10)

### Strengths verified

- The step-definition gate (`e2e-steps.test.ts`) is real: AST-parses
  every step file, fails assertion-less Then steps and unreferenced
  steps, documented against the two shipped failure classes it was built
  for, and runs in the unit suite.
- All of `services/` and `lib/security/` unit-covered, including
  obfuscated-scheme cases in `safe-url.test.ts`.
- Newer step files use API-derived capability skips correctly
  (`ptz.steps.ts` via `isMonitorControllable()`, `events.steps.ts` via
  `getEventCount()`), with the anti-self-confirmation rationale inline.
- The real-store regression template for selector-loop bugs exists
  (`NotificationHistory.realstore.test.tsx`).
- The three biggest step files (monitors, montage, all-profiles) are
  clean of conditional passes.

### Findings

**P5-1 (HIGH, confirmed).** The profile-creation e2e chain can pass
without creating a profile. `profiles.steps.ts:103-105` fills the name
only if the testid is visible; `:145-148` treats a disabled Add button as
acceptable ("that's OK for test"); the Then at `:163-171` falls back to
`count() >= 1` when no name was recorded, which the pre-existing default
profile always satisfies (the file's own comment at `:160-162` explains
exactly this failure for the by-name branch). Rename the testid, break
form rendering, or regress validation and `profiles.feature` stays green
while users cannot add a server. Fix: hard-assert the form fields (the
form's visibility was already asserted one step earlier, so absence is a
regression, not a capability), drop the count fallback, make the name
unconditional; the hard-assert conversion at `events.steps.ts:559-564` is
the pattern. Verification: P5-5's gate extension proven red against this
file; manual `npm run test:e2e -- profiles.feature` (degraded-server
caveat, #342). Effort S (3 sites, one file). Risk: may surface a real red
the fallback was hiding. CI-verifiable. Contracts: C6, P2.

**P5-2 (HIGH, confirmed).** `group-filter.steps.ts:36` reassigns
`groupFilterAvailable` from `isVisible()`, overwriting the API-derived
flag set at `:26` from `getGroupCount()`, and the file's own comment at
`:13-16` documents why that exact pattern is banned (a filter that stops
rendering silently skips every later step). This is a regression to the
anti-pattern the file was fixed to remove; a shipped "group filter
disappeared" bug passes CI. Fix: delete the reassignment; hard-assert the
select when `serverGroupCount > 0`. Verification: a step-body assertion
in the P5-5 gate (no capability flag assigned from `isVisible` in step
bodies), proven red against current code. Effort S (1 site). Contracts:
C6, M1, self-improvement route (code/playbook mismatch).

**P5-3 (MED, confirmed).** The bandwidth-toggle scenario cannot detect a
broken toggle: the When (`settings.steps.ts:180-188`) silently no-ops
when no selector matches, and the Then (`:190-195`) asserts static
`/low|normal/i` text present on the page regardless of any action.
Named missed bug: bandwidth mode stops persisting and the suite stays
green while metered-connection users lose the control that drives every
polling interval. Fix: capture pre-toggle state, hard-assert the toggle
(app-owned UI), assert the label changed; the `expect.poll` inversion
check at `:174-177` is the in-file pattern. Effort S (2 sites; may need
a `data-testid` added to the page). Contracts: C6, Polling adjacency.

**P5-4 (MED, confirmed).** 43 fixed `waitForTimeout` sleeps across 10
step files against the playbook's explicit ban, with no gate; worst
offenders `events.steps.ts` (12), `settings.steps.ts` (8),
`common.steps.ts` (6). Fixed sleeps slow every run and convert real
timing bugs into rare flakes. Fix: a third check in `e2e-steps.test.ts`
failing on `waitForTimeout` in step bodies, seeded with an allowlist of
the 43 current sites that only shrinks (the lint-ratchet pattern); burn
sites down opportunistically. Verification: gate proven red before
allowlisting (P2). Effort M (gate S; 43 replacement sites are the long
tail). Risk: naive replacements flake where a sleep hid a real
transition; replace per-site with the actual awaited condition.
Contracts: M1, C7, P2.

**P5-5 (MED, confirmed).** The Then-assertion gate checks assertion
presence, not reachability: `e2e-steps.test.ts:99` regex-tests the whole
body, so a step opening with a visibility-guarded `return` passes while
being skippable to a no-op; every conditional-pass step above sails
through, and an `expect(` inside a comment also satisfies it. Fix: the
AST walk already exists; flag guard-clause returns in Then bodies not
preceded by an assertion unless the guard references an allowlisted
API-derived capability helper, and flag `isVisible().catch(() => false)`
in Then guards outright. Verification: proven red against current
`settings.steps.ts` and `profiles.steps.ts`, green after P5-1..P5-3
land. Effort M (about 40 lines of AST analysis plus the step fixes it
forces). Risk: false positives, absorbed by the helper allowlist.
Contracts: M1, M2, C6.

**P5-6 (LOW, confirmed).** Notification-toggle persistence Then
(`settings.steps.ts:161-164`) skips on visibility of the UI under test;
the assertion once reached is good. Fix: hard-assert the toggle renders.
Effort S (2 sites). Contracts: C6.

**P5-7 (LOW, confirmed).** `events.steps.ts:762-779` passes if any one
of video player, favorite button, or download button is visible; a
broken video player is masked by the favorite button. Fix: assert the
player specifically; keep the genuinely conditional download logic as
is. Effort S (1 site). Contracts: C6.

**P5-8 (LOW, confirmed).** `assistant.steps.ts:87-100` hover pair skips
on rendered thumbnail count instead of the API-derived
`getEventCount()` one file over; cards rendering without thumbnails
no-ops both steps forever. Fix: gate on the API helper, hard-assert the
thumbnail. Effort S (2 sites). Contracts: C6.

Plausible bugs the suite would miss today: bandwidth mode stops
persisting (P5-3); add-profile silently broken by a testid rename or
stuck-disabled Add (P5-1); group filter stops rendering (P5-2). All
three would ship green.

### Path to 10/10

Worth it: the P5-5 gate extension (permanently closes the
conditional-pass class and forces P5-1/2/3/6/8); the P5-2 one-line fix;
the P5-4 ratchet gate; hard-asserting the P5-1 chain.

Not worth it: rewriting all 43 sleeps in one wave (per-site condition
analysis is the real cost; ratchet and burn down); chasing full e2e
determinism against the shared demo server (API-derived data skips are
the sanctioned design; fixtures are a different architecture); unit
tests duplicating e2e journey assertions (playbook forbids
double-covering); auditing the 423 `toBeVisible`/`toHaveCount` unit
hits wholesale (sampled ones assert fetched values, which C6 permits).

## Pillar 6: runtime performance (8.3/10)

### Strengths verified

- Viewport gating: one IntersectionObserver for the whole montage grid,
  ref callbacks cached per tile id per the c8d0d833 lesson, linger
  timers, unmeasured-counts-as-gated cold-start handling.
- Canvas reallocation guarded by `lastCanvasDimsRef` with the GPU-bitmap
  rationale in-file.
- CMD_QUIT teardown verified on every path (unmount, connkey regen,
  disable, view-mode change, hover previews, StrictMode-guarded); no
  missed path found.
- Selector hygiene near-universal: 78 `useShallow` sites, zero minting
  selectors without it, zero whole-store subscriptions.
- Timeline props fully memoized upstream so the canvas memo holds;
  pull-to-refresh keeps per-frame distance in a ref.

### Findings

**P6-1 (MED, confirmed).** `MontageGridSections.tsx:228` passes
`onPinToggle={() => onPinToggle(tileId)}`, a fresh closure per render,
so the `memo(MontageMonitorComponent)` wrapper never bails out and every
tile re-renders on every Montage render (polling, scroll gating changes,
TV focus, pinch frames). Every other prop is stable. On a 16-30 tile
wall on Fire Stick or low-end Android this is continuous reconcile work;
streams survive, so the cost is jank, not teardown. Fix: give the child
a `tileId` prop and a stable `(tileId) => void` callback (the
cached-callback shape `useViewportGating` already uses); only one caller
passes this prop. Verification: unit test asserting the tile render
count does not grow on a parent re-render with unchanged data, proven
red pre-fix; smoothness itself device-only. Effort S (2 files).
Contracts: C6 for the test shape.

**P6-2 (MED, confirmed).** `usePinchZoom.ts:43` calls `setScale` per
gesture frame; the scale is consumed only as a CSS transform on one
wrapper div (`Montage.tsx:690`), so every pinch frame re-renders the
whole montage page on exactly the platform least able to afford it.
Fix: write the transform imperatively via a ref during the gesture and
commit state only on gesture end; the hook has exactly one consumer, so
its API can change freely. Verification: render-count probe red
pre-fix; pinch feel is device-only. Effort S/M. Risk: rubberband and
reset-button edge cases.

**P6-3 (MED, confirmed).** `MontageMonitor.tsx:153-155` calls
`getProfileSettings` (which mints a fresh merged object per call) inside
a `useShallow` selector, the Stores-contract Never clause, and
`stores/settings.ts:560-562` documents having routed a coercion into a
persist migration specifically to keep this selector from looping. The
latent cost: the next nested-object coercion added to
`mergeProfileSettings` (its sanctioned home) re-introduces a maximum
update depth crash in every montage tile. Ongoing cost: every settings
write runs a full merge in every mounted tile. Fix: raw-slice select
plus `useMemo(mergeProfileSettings)` per `useCurrentProfile.ts:83`; the
one sibling site is `NotificationSettings.tsx:99` (cold page, optional).
Verification: real-store regression test per the testing playbook,
proven red by temporarily minting a nested object in the selector.
Effort S. Contracts: Stores, Settings; route the contract note through
the self-improvement protocol.

**P6-4 (LOW, confirmed).** `timeline-renderer.ts:662` resolves theme
colors via `getComputedStyle` on every paint, and paints run per
pan/zoom frame and at ~60fps inside the live-pulse rAF loop. Fix:
resolve `ThemeColors` once per mount and theme change in
`TimelineCanvas` and pass it in; both call sites are single. Effort S
(2 files). Risk: theme switch while open must still recolor.

**P6-5 (LOW, confirmed).** `MontageGridSections.tsx:166-167` rebuilds
`layoutByTileId` and `globalIndexByTileId` Maps every render. Fix:
`useMemo` on `[layout]` and `[cappedMonitors]`; fold into the P6-1
commit. Effort S (2 lines).

### Path to 10/10

Worth it: P6-1 plus P6-5 in one commit (restores the memo barrier the
rest of the montage work assumes); P6-2; P6-3 with its real-store test;
P6-4.

Not worth it (load-bearing): virtualizing EventListView or Logs (failed
twice, domain playbook); memoizing `MontageGridSections` before P6-1
(the closure busts any wrapper); offscreen-canvas or WebGL timeline
work; per-tile observers; restructuring the grid's children (ref
swallowing trap, c8d0d833); throttling viewport pan/zoom state (per
frame is what makes panning feel direct; make frames cheaper instead).

## Pillar 7: native platform integration (7.8/10)

Every finding in this pillar is device-pass-required; no CI gate compiles
or exercises native code.

### Strengths verified

- Native logging discipline holds (refs #307): `PipActivity.java` strips
  query strings, logs error-code names instead of raw media3 errors, and
  logs URL presence as a boolean; no native log statement carries a URL
  or raw error.
- Lifetime hygiene: once-only session invalidation with the retain-leak
  rationale, PiP releases player and session, TV cursor removes its
  runnable, download state cleared on both paths.
- Main-thread discipline marshaled at every UIKit/WebView touch point,
  with the bridge-queue reason commented.
- Permission surface minimal and annotated (pre-declared API 37
  local-network permission refs #333; media permissions deliberately
  absent refs #190).
- iOS/Android parity engineered where it exists: mirrored busy-slot
  design, shared error-code vocabulary, matched cert-expiry formatting.
- SDK currency good: Capacitor 8.4, target SDK 36, iOS 16.0, Electron 42.

### Findings

**P7-1 (HIGH, confirmed from source; device-pass-required).**
`SSLTrustPlugin.swift:84`, `getServerCertFingerprint`: the plugin call is
resolved only inside the cert-fetch delegate's server-trust challenge
handler, and the data-task completion closure is
`{ _, _, _ in session.invalidateAndCancel() }`, which discards the error.
When the request ends without a TLS challenge (http portal URL, DNS
failure, connection refused, timeout, server down) the call never settles.
The JS wrapper (`lib/security/ssl-trust.ts:152`) has no timeout, and its
awaiters are user-visible: profile bootstrap awaits it at
`profile-bootstrap.ts:316` (TOFU migration hangs when the server is
down), `ProfileForm.tsx:236` (save spinner hangs forever on an http
portal with self-signed enabled), and the cert-verify buttons. Android
rejects in the same case, so the same user action hangs on iOS and
toasts on Android. Fix: complete the call from the data-task completion
closure, guarded by the delegate's existing `completed` once-only flag
(move it into a shared box the closure can consult); reject with the
existing failure message. Verification: device pass, two scenarios:
self-signed profile with an http portal must error on save, not spin;
https profile with the server off must proceed past bootstrap. A
JS-side wrapper timeout is the unit-testable alternative if preferred.
Effort S (one closure plus the shared flag). Risk: paths that hung now
show an error banner; no success-path change. Contracts: I2, Native.

**P7-2 (MED, confirmed from source; device-pass-required).**
Android pin bypass. With self-signed mode enabled,
`SSLTrustPlugin.java:250-257` installs a `HostnameVerifier` that returns
`enabled` for all hosts, and `checkServerTrustedForHost`
(`:276-283`) returns success for any chain the system trust store
validates before consulting the pinned fingerprint. Combined: an active
interceptor holding any publicly-valid certificate for any name is
accepted on a pinned host, because chain validation passes and hostname
matching is disabled. On iOS the equivalent arm is
`SecTrustEvaluateWithError` with the SSL policy, which includes the
hostname, so the pin holds there. This exceeds the documented deliberate
relaxations (accept-any-cert only before a fingerprint exists; global
trust), so it is a code/contract gap, not a recorded decision. Fix: in
`verify`, run the saved original verifier first, then allow only the
no-pin TOFU arm or a peer-cert fingerprint match; in
`checkServerTrustedForHost`, consult the pin before the system-valid
short-circuit when a fingerprint exists for the host (mirror the iOS
ordering comment at `SSLTrustPlugin.swift:319-324`). Verification:
device pass, three scenarios: pinned self-signed profile still works; a
proxy with a CA-valid cert for another name against the pinned host is
rejected; a CA-valid second profile still works. Risk: users reaching a
CA-certified server by an address not in its SAN currently ride the
blanket verifier and would need the no-pin arm; document accepted risk
per the native playbook if behavior shifts. Effort M (two sites, one
file, security-sensitive accept path). Contracts: I3, Native,
self-improvement route.

**P7-3 (LOW, confirmed).** `GeminiNanoPlugin.java:157-187` `download`
has no in-progress guard, unlike `LlamaPlugin.downloadModel` which
rejects `DOWNLOAD_IN_PROGRESS`; two concurrent calls interleave progress
events and double-settle UI flows. Fix: the file's own busy-slot idiom
(`AtomicReference` with `compareAndSet`). Device pass on an
AICore-capable device. Effort S. Contracts: parity intent, I1.

**P7-4 (LOW, confirmed, comment-only).** Three iOS comments reference
the removed Android llama.cpp engine as if it exists
(`LlamaEngine.swift:239` "see llama_jni.cpp";
`LlamaEngine.swift:131-132` and `LlamaPlugin.swift:36-38` "Mirrors
Android's onTrimMemory hook"); the Android JNI engine was removed
(refs #306, and `15-assistant.rst` documents the removal). Fix: reword
to past tense. No device pass needed. Effort S (3 sites).

**P7-5 (LOW, confirmed).** Four dead `#available(iOS 15.0, *)`
else-branches under the 16.0 deployment target
(`SSLTrustPlugin.swift:149,311,403`; `SafeAreaPlugin.swift:88`),
including the deprecated `SecTrustGetCertificateAtIndex` path, tripling
the reading surface of cert-extraction code. Fix: delete the checks,
keep the modern arm, hoist the triplicated leaf-cert extraction into one
helper. Verification: iOS build compiles clean; ride a TOFU device
smoke. Effort S (4 sites). Contracts: C2.

**P7-6 (LOW, theoretical).** Unsynchronized cross-thread native state at
four sites (non-volatile `enabled` in `SSLTrustPlugin.java:50`; the iOS
static fingerprint map whose comment claims an atomicity Swift does not
provide; unlocked download state in `LlamaPlugin.swift:100-103`;
check-then-set busy slots in `GeminiNanoPlugin.java:209-211`).
Worst cases today are benign, hence theoretical, but the "atomically"
comment will mislead the next editor. Fix: `volatile`, `compareAndSet`,
and the file's existing `NSLock` idiom. Effort S/M. Device regression
pass on TOFU and downloads after.

### Path to 10/10

Worth it: P7-1 (the only hang-class defect); P7-2 (makes the pin mean
the same thing on both platforms); a mechanized grep gate for the
native-logging rule the playbook itself calls ungated (M1); P7-4 plus
P7-5 riding the next native PR's device pass.

Not worth it: restoring llama.cpp on Android (deliberately removed,
refs #270/#306); native Gemini Nano cancellation (crashes via the
documented coroutines pin); an iOS PiP plugin (WKWebView native video
PiP covers it); Electron fingerprint pinning (the shell is documented
experimental with an explicit do-not-promote note); refactoring
SSLTrust's statics (Foundation instantiates the URLProtocol; the statics
are the mechanism); tuning ML Kit `ModelConfig` (unmeasured knobs stay
unset per the in-code note).

## Pillar 8: accessibility and UX robustness (8.1/10)

### Strengths verified

- The blocking a11y gate is isolated from the advisory backlog, so a new
  jsx-a11y violation fails CI and pre-commit; verified 0 on main.
- Reduced motion handled at both layers (global CSS neutralizer plus a
  JS check skipping view transitions), with cross-referencing comments.
- All 84 `size="icon"` button sites carry an accessible name (brace-aware
  element audit, not a line grep); long-press hints give touch users a
  `title` equivalent.
- Offline banner (`role="status"`) wired for native and web network
  detection; TV mode has a 4px focus ring, larger base font, and spatial
  navigation enabled at startup.
- Dark and amber themes pass every computed core contrast pair.

### Findings

**P8-1 (MED, confirmed by computation from real tokens).** Cream theme
secondary text fails WCAG AA: `--muted-foreground: 28 12% 48%`
(`index.css:336`) computes 3.77:1 on background, 3.56:1 on card, 3.16:1
on muted, all below the 4.5:1 normal-text minimum; slate's
muted-on-muted is marginal at 4.42:1. `text-muted-foreground` is the
app-wide secondary-text class, so this is most supporting text in cream.
Fix: darken cream muted-foreground to about `28 14% 40%` and nudge
slate; then add a vitest that parses the theme blocks and asserts the
core pairs at 4.5:1 or better (about 30 lines, no dependencies), proven
red against current cream values. Effort S (2 token lines plus 1 test).
Risk: slightly less warm cream; CI-verifiable, visual spot-check on
device. Contracts: I3.

**P8-2 (MED, confirmed by computation).** Destructive button text
computes 3.59:1 in light and 3.40:1 in cream
(`--destructive: 0 84.2% 60.2%` with near-white foreground,
`index.css:250-251` and `:339-340`); dark, slate, and amber use the
darker red and pass. These are the delete and disconnect confirmations.
Fix: darken the light/cream destructive token to about `0 72% 45%`;
covered by the same token-contrast test. Effort S. Contracts: I3.

**P8-3 (MED, confirmed).** Montage alarm indication vanishes for
reduced-motion users and never exists for screen readers. The alarming
state's only conveyance is `isAlarming && "montage-alarm-pulse"`
(`MontageMonitor.tsx:253`); the `alarm-pulse` keyframes are transparent
at 0% and 100% (`index.css:215-221`), and the global reduced-motion rule
(`index.css:106`) forces one 0.01ms iteration, freezing the pulse at
transparent. No ARIA exposure of `isAlarming` exists. Distinct from the
documented spinner tradeoff: a frozen spinner still reads as loading; a
pulse frozen at transparent conveys nothing, in a security-monitoring
app. Fix: a reduced-motion static tint override for
`.montage-alarm-pulse` (alpha at or below 0.35), plus alarm text via
`role="status"`/`aria-label` on the tile header when alarming, keys in
all five locales (C3). Verification: unit test asserting the alarm aria
text appears when the store seeds an alarm, red pre-fix; tint appearance
device-checked. Effort S (1 CSS block, 1 attribute, 5 locale keys,
1 test). Contracts: I3, C3.

**P8-4 (LOW, confirmed empty today by probe).** The recommended jsx-a11y
set the gate spreads ships `control-has-associated-label` off and omits
`no-aria-hidden-on-focusable`, exactly the class that catches an unnamed
icon button; a probe with both at error found 9 hits, all in test mocks,
0 in production. Enabling is free now and guards the currently-clean
state. Fix: enable both at error in `eslint.a11y.config.js`, label the 9
test mocks or scope the rules to production sources. Verification:
removing an `aria-label` from a montage button must turn the gate red
(M2-style input check). Effort S. Contracts: M1, M2.

**P8-5 (LOW, confirmed).** Three icon buttons at 20x20 CSS px fall below
the WCAG 2.2 24x24 target minimum: `AppearanceSection.tsx:434,447`
(stacked reorder buttons, so the spacing exception does not apply) and
`GridLayoutControls.tsx:188`. Fix: `h-8 w-8` with the existing glyph, or
padding-grown hit areas. Effort S (3 sites). Cosmetic tier, existing
gates plus device look. Contracts: I3.

**P8-6 (LOW, theoretical).** `tv-spatial-nav.ts:21-24` swallows spatial
navigation failure silently; on a real TV device a plugin failure leaves
the d-pad dead with zero diagnostics (and keyboard shortcuts have
deliberately stood down in TV mode). The success log also uses the
`auth` category. Fix: WARN in the catch when `Platform.isTVDevice`,
correct the category. Verification: unit test with a mocked rejection,
red first. Effort S. Contracts: Logging.

### Path to 10/10

Worth it: P8-1 and P8-2 with the token-contrast vitest (the only way the
a11y gate's zero ever speaks to color); P8-3; P8-4 while it costs nine
mechanical edits.

Not worth it: enlarging the 37 buttons already at or above the WCAG 2.2
minimum (dense toolbars, 320px rule); converting title-only names to
aria-label (title computes a valid name, long-press covers touch);
axe-core in e2e (static classes are covered; runtime axe adds flake
against the shared server); captions for CCTV streams (no dialogue);
offline data persistence (stale camera frames could mislead more than
help).

## Pillar 9: build, CI, dependency health (7.9/10)

### Strengths verified

- Branch protection live-verified via the GitHub API: 7 required
  contexts (unit-tests, lint, build, lint-a11y, lint-react-correctness,
  native-version-guard, label-guard); force pushes and deletions blocked.
- Advisory-lint plus hard-ratchet is deliberate and layered: full lint
  is continue-on-error with the #217 rationale inline, then the same
  required job runs the ratchet as a hard step.
- Hooks mirror CI with documented bypass defense: the CI
  native-version-guard re-checks every commit precisely because hooks
  can be skipped.
- No dead package.json scripts (every referenced file exists);
  dependency currency is mostly patch/minor drift; label-guard skips
  fork PRs correctly and fails closed on non-conventional subjects.

### Findings

**P9-1 (MED, confirmed on a live run).** The CI e2e job reports success
while every step is skipped. `ci.yml` gates all real steps on
`secrets.ZM_HOST_1` and friends, which are absent in this repo; run
31095541802 shows `e2e-tests` concluded `success` with Setup Node,
Install, and `Run E2E tests` all `skipped`. The 60-file, 8,152-line
Playwright suite has never run in CI, while the green check reads as
"e2e passed". Fix, minimum: make the skip loud (a notice step, and a
job conclusion that is not a bare success for a no-op), 2 sites
(`ci.yml`, `test.yml`). Fix, full: a containerized ZoneMinder service
feeding the secrets. Verification: a PR run showing the notice (or the
step executing). Effort S for the loud skip, M for the service. Risk:
service flake in CI, mitigated with retries. Contracts: P3, the
project's own UI-change e2e rule.

**P9-2 (MED, confirmed by reproduction).** `.husky/pre-commit:12` runs
`npx lint-staged`, but no lint-staged configuration exists anywhere (no
key in either package.json, no rc file), so it matches zero files and
exits 0; reproduced. The hook's comment claims it "runs eslint on staged
files and surfaces problems"; it surfaces nothing, and `lint-staged` v17
is installed as a root devDependency for this single dead call.
Contributors believe advisory lint feedback happens at commit time; only
the CI ratchet actually catches growth, post-push. Fix: add
`"lint-staged": { "*.{ts,tsx}": "eslint" }` (keeping the advisory
`|| echo` wrapper), or delete the call, the dependency, and the comment.
Verification: stage a file with a known lint error, run the hook,
observe output (nothing before, output after). Effort S (1 site).
Contracts: M2.

**P9-3 (MED, confirmed).** `scripts/__tests__/` (tests for
`check-native-version-bump.mjs`, the engine behind the required
native-version-guard check, plus `generate_notice`) runs in no workflow,
hook, or gate; root `test:scripts` appears nowhere in CI. A regression
in the guard script would merge silently, the exact bypass the guard
exists to prevent. Fix: add `node --test scripts/__tests__/*.test.mjs`
to the native-version-guard job (already checked out with Node at repo
root). Verification: break the guard locally, confirm the new step goes
red, revert (P2). Effort S (1 site). Contracts: P3, M1.

**P9-4 (MED, confirmed).** `agents/project/domain-context.md:156` says
the linux-arm64 job runs under qemu and needs Node 18 and must not be
bumped; the actual workflows run on native `ubuntu-24.04-arm` with
Node 22 and no qemu step exists. The stale entry misinformed this
review's own dispatch briefs, demonstrating the failure mode: agents
trust the playbook over the code, as instructed. Fix: correct the entry
via the self-improvement protocol. Verification: the agents-contracts
doc checks stay green. Effort S. Contracts: M3, M5.

**P9-5 (MED, confirmed by raw output).** `npm audit` in `app/`:
`22 vulnerabilities (1 low, 9 moderate, 11 high, 1 critical)`; the root
lockfile carries 9 more. The critical is `tar` (arbitrary file
overwrite) under `@capacitor/cli`, dev-time; highs include the direct
runtime dependency `react-router-dom` (RSC-mode CSRF bypass; RSC unused
in this Vite SPA, so runtime exposure is low) and build-chain CVEs
(sharp/libvips, serialize-javascript, minimatch). The bulk is
`npm audit fix`-able; `playwright-bdd` needs a deliberate version bump.
Fix: `npm audit fix` both lockfiles, bump `playwright-bdd` past 8.5.1
and `react-router-dom` to the patched line; then `npm run gates` plus
one local e2e feature (the bdd generator changed, and e2e does not run
in CI per P9-1). Effort M. Contracts: I3.

**P9-6 (LOW, confirmed).** Five release workflows use the mutable
third-party tag `softprops/action-gh-release@v1` (two majors old) in
jobs with `contents: write` publishing user-facing installers;
`codecov/codecov-action@v4` similar in test.yml. A compromised tag
re-point executes with release-write. Fix: pin to full commit SHAs and
bump to v2; first-party `actions/*` may stay on tags. Verification: one
manual `workflow_dispatch` build per pattern producing artifacts
(release path has no CI gate). Effort S (6 sites). Risk: v1 to v2 input
renames. Contracts: I3.

**P9-7 (LOW, confirmed).** `test:platform:setup` invokes `tsx`, which is
not declared in app dependencies; it resolves only through transitive
hoisting, so an unrelated lockfile refresh breaks the onboarding script.
Fix: declare `tsx` as a devDependency or convert the script to `.mjs`.
Effort S. Contracts: C1.

**P9-8 (LOW, confirmed).** `desktop_release_builds/tauri/.gitkeep` is
tracked yet matched by its own `.gitignore` rules (the electron-only
exception postdates it); the sole hit of `git ls-files -i`. Fix:
`git rm` it; tauri builds are gone from all 16 workflows. Effort S.
Contracts: C2.

### Path to 10/10

Worth it: P9-3 (closes a bypass-of-the-bypass-guard hole for one CI
step); P9-2; P9-4; P9-5; P9-1 loud-skip at minimum; P9-6.

Not worth it: hard-gating full `npm run lint` before the 202-problem
backlog burns down (blocks every edit to about 94 files; the ratchet
already prevents growth); requiring the e2e context in branch protection
while it needs live-server secrets (always-skipped or fork-blocking);
chasing minor `npm outdated` drift; CI for device e2e (manual-only by
project rule); consolidating the per-platform build workflows (each
standalone dispatch is the recovery path when one platform needs a
rebuild).

## Pillar 10: documentation and handover (7.4/10)

### Strengths verified

24 code-citing claims spot-verified against opened source; 19 exact,
including `maxToolIterations: 6`, the 5.5 GiB LlamaPlugin memory floor,
the 11-key `NAV_SHORTCUTS` table key-for-key, bandwidth intervals, the
six-theme list, and discovery error codes. Flow 19 (assistant), the
newest large flow, is precise throughout. The user guide has no page
gap: every user-facing page maps to a guide file, and All mode is
canonically documented once in profiles.md, covering every aggregating
surface.

### Findings

**P10-1 (HIGH, confirmed at 16 sites).** Four developer-guide chapters
still document the retired API-client singleton
(`setApiClient`/`getApiClient`/`resetApiClient`) as the sanctioned HTTP
path: `call-flows.rst:144` (Flow 1 step 5), `:741` (Flow 6 step 9),
`:1730` (Flow 16), `03-state-management-zustand.rst:391-394`,
`07-api-and-data-fetching.rst:78,82,105,135,156,313-314,1056` (login
example imports `getApiClient`; prose says all HTTP goes through it),
`12-shared-services-and-components.rst:266,1657`. Those symbols exist
nowhere in `app/src` except the contract test that forbids them ("the
deleted singleton stays deleted", `agents-contracts.test.ts`), and
`getSession`, the Sessions contract's sanctioned path, appears zero
times in call-flows, chapter 03, or chapter 12. A contributor following
the guide writes the exact pattern the gate rejects. Fix: one editing
pass over the four chapters onto the sessions path
(`getSession` to `createStoreApiClient` to `createApiClient`), with the
real symbols for the three flow steps; add a doc-side scan failing on
the three forbidden symbols in `docs/developer-guide/*.rst`, proven red
against current docs (P2). Verification: `npm test` from `app/` (doc
gates). Effort M (16 sites, 4 files; the correct replacement text
already exists in the contract and code comments). Risk: introducing
fresh drift while rewriting; mitigate by citing only symbols the
contract test names. Contracts: P10, Sessions, HTTP.

**P10-2 (MED, confirmed).** Flow 1 step 11 and Flow 2 step 1
(`call-flows.rst:193-197`, `:233-242`) assert the monitors query is
gated on `isAuthenticated` and single-profile keyed; both pages now
render through `useScopedMonitors`, and the auth gate was deliberately
removed because it left untouched profiles silently missing from All
mode (`useScopedMonitors.ts:75-83`, refs #337). A reader "fixing" the
perceived missing gate would reintroduce that bug. Fix: rewrite the two
steps around `useScopedMonitors` and the proactive-login self-heal.
Effort S. Contracts: P10, Aggregation, Server queries.

**P10-3 (MED, confirmed by sampling).** Line-anchored `blob/main` source
links have rotted: the constants links are off by about 660 lines
(`#L499` vs actual 1159, and siblings), `getFreshAccessToken` off by
107; 246 anchored links exist in call-flows alone. Fix: strip the `#L`
anchors to file-level links in one mechanical pass (the prose already
names the symbol, which is greppable), then a docs test asserting no
`#L` anchors in developer-guide links, proven red first. Effort L by
raw count but mechanical. Contracts: P10, the documentation playbook's
link rule.

**P10-4 (LOW, confirmed).** `call-flows.rst:693` names `checkAndRefresh`;
the actual symbol is `checkAndRefreshAll` (`useTokenRefresh.ts:50`).
One-word fix. Contracts: P10.

### Path to 10/10

Worth it: P10-1 with its doc-side symbol scan (the whole gap between
trustworthy and misleading for a new contributor); P10-2; P10-3; P10-4.

Not worth it: hand re-verifying all remaining source links (after P10-3
the file-level links plus symbol names self-heal); renumbering chapters
to close the 07-to-09 gap (no link is broken; renumbering invalidates
external links for zero reader value); duplicating the All-mode section
into per-page guides (one canonical page prevents five-way drift);
expanding thin-but-accurate pages for volume.

## Pillar 11: error handling and trust boundaries (8.8/10)

### Strengths verified

- Schema tolerance systematic in `api/types.ts`: every ZM row schema
  uses `withFieldCatch` with an identity pair, every list
  `tolerantArray`; the #247 incident is written into the MonitorSchema
  doc block; `ZMUserSchema` degrades permission drift to unknown rather
  than failure (refs #344).
- All 25 empty-or-comment-only catch bodies in production code sit on
  genuinely non-fatal paths with a justification comment; no silent data
  loss behind any of them.
- Bulk event delete is a model destructive path: `Promise.allSettled`,
  partial-failure toasts naming surviving counts, permission refusals
  distinguished from timeouts, a written rationale for not reporting
  cache-update failure as delete failure.
- Profile delete tears down sessions, auth, notifications, pollers, and
  query cache, with secure-storage failure unable to block the delete.
- Downloads honor cancellation (no silent restart after abort), route
  failure to the task store, and sanitize server-controlled filenames.
- `lib/is-abort-error.ts` exists precisely against error-class
  misdetection, and the Electron IPC bridge rebuilds errors preserving
  `name` so name-based checks survive the boundary.

### Findings

**P11-1 (MED, confirmed).** `api/notifications.ts` is the only api/
module with zero Zod validation: `registerToken` (`:61`) and
`updateNotification` (`:89`) return `resp.data.notification.Notification`
through a bare TS cast. A ZM server without the notifications API, a
proxy answering 200 with HTML, or field drift produces a TypeError
instead of a diagnosable validation error, and that TypeError is
absorbed by the caller's log-only catch (P11-2), becoming an unexplained
silent registration failure. Fix: schema with
`withFieldCatch({...}, ['Id'])` validated via `validateApiResponse`,
exactly like `api/users.ts:45-50`; update `api/__tests__/types.test.ts`
per the playbook. Verification: schema test proven red against the
current cast with a drifted payload. Effort S. Risk: over-strict types
rejecting live responses; device pass confirms against a real server.
Contracts: I1, data-integrity playbook.

**P11-2 (MED, confirmed).** Direct-mode push registration failure is
log-only while the UI reports active.
`services/pushNotifications.ts:456`: the catch around the one call that
turns push on does nothing but log; `NotificationSettings.tsx:290-294`
renders the direct-active status keyed on mode and `settings.enabled`,
intent rather than outcome. A user enables direct notifications, sees
active, and silently never receives a push; the ES branch already does
this right (toasts `connect_failed`). Fix: surface the failure on
user-initiated flows and derive the status line from
`settings.notificationId` presence; new locale keys across all five
locales (C3). Verification: unit test proving a rejected `registerToken`
produces the user-visible failure state, red pre-fix; the real push
round-trip is a device pass. Effort S/M. Risk: background
re-registration must not nag; scope the toast to user-initiated flows.
Contracts: I2, C3, Notifications.

**P11-3 (LOW, confirmed).** Three `api/server.ts` schemas
(`LoadSchema:51`, `DiskPercentSchema:59`, `DaemonCheckSchema:79`) are
plain `z.object` while the file's own comment claims the tolerant
pattern; a type drift in one host stat blanks the whole server-stats
surface instead of degrading one number. Fix: wrap in `withFieldCatch`
like the siblings two lines up; pick fallbacks that render as unknown,
not zero. Effort S (3 schemas). Contracts: I1.

**P11-4 (LOW, confirmed inconsistency; impact theoretical).**
`window-interpreter.ts:261` and `AskPanel.tsx:686` guard aborts with
`instanceof DOMException` instead of the repo's own `isAbortError`; in
`interpretWindow` a misclassified abort is not rethrown but cached as a
failed interpretation, poisoning that phrase's window for the session.
Fix: `isAbortError` at both sites. Verification: unit test rejecting
with a plain object named AbortError, proving rethrow-not-cache, red
pre-fix. Effort S (2 sites). Contracts: I1, C1.

**P11-5 (LOW, confirmed).** About 8 toast or setError sites show raw
`error.message` prose to users (`Profiles.tsx:229,268,290`,
`VirtualProfileDialog.tsx:89`, `profile-switcher.tsx:90`,
`Logs.tsx:374`, `NotificationSettings.tsx:201`,
`useGo2RTCStream.ts:290`), bypassing the `resolveQueryError` mapping;
non-English users get English transport internals, and a Zod dump is
unreadable to anyone. Fix: route through `resolveQueryError` or the
localized fallback alone, keeping the raw message in the adjacent log
call. Effort M (8 sites plus locale keys). Contracts: Query UI states
in spirit, C3.

**P11-6 (LOW, theoretical).** `api/events.ts:427-433`
(`getConsoleEvents`) trusts an endpoint the doc comment itself marks
unverified, through a bare cast; a malformed `results` yields NaN
counts silently. Fix: `z.record` with coerced-number catch, or a
`Number.isFinite` filter. Effort S (1 site). Contracts: I1.

### Path to 10/10

Worth it: P11-1 plus P11-2 together (one user-facing defect: push that
fails dark); P11-4 (two lines, closes a cache-poisoning edge); P11-3.

Not worth it: Zod-validating `getMonitorEventsSince` (the code documents
why validation adds a failure mode there; re-adding is compliance
theater); toasting background failures that degrade correctly (badge
sync, haptics, PiP); typed error machinery over the justified empty
catches; hunting the remaining ~40 message-extraction `instanceof Error`
sites (the `String(err)` arm drops nothing; only classification sites
matter and both are in P11-4).

## Pillar 12: security

Not assessed. Offered to the maintainer at review start and declined for
this run, consistent with the first review. Security-adjacent findings
that arrived through other pillars (P7-1, P7-2, P9-5, P9-6) are reported
there and are in scope for execution.

## Non-findings

Things that look wrong and must stay. An executor "fixing" any of these
ships a regression.

- **TLS trust-on-first-use accepts any certificate when no fingerprint
  is stored, and trust is global once any profile enables self-signed.**
  Deliberate maintainer decisions recorded in the Native contract and
  the all-profiles spec; fail-closed breaks self-signed onboarding, and
  multi-server ZM installs route streams at hosts that differ from
  profile URLs. P7-2 is about the pinned-host case only.
- **`madge --circular` reporting 4 cycles while the cycle gate is
  green.** All four traced; each closes only through a sanctioned
  `await import()` break. The gate deliberately walks static imports
  (including type-only ones madge-style builds erase).
- **Access tokens in stream and image URLs.** `img`/`video` cannot send
  headers; the ZM protocol requires it; the log sanitizer redacts them.
  The contract text is the bug (P3-5), not the code.
- **The one production `console.warn`** (`lib/log-file/capacitor.ts:56`):
  the logger cannot log its own persistence failure without recursing.
- **`useStreamLifecycle`'s five-effect teardown web and
  `LiveMonitorPlayer`'s four watchdog refs.** Every branch maps to a
  documented incident (ee8a7c9d, bef8c42d, e261e539, fe042a14); the
  freeze/fallback path is device-only to verify. Do not refactor into a
  named state machine.
- **List virtualization of EventListView and Logs.** Failed twice with
  `@tanstack/react-virtual` (blank rows, stale text). Do not re-attempt
  without a materially different approach.
- **Montage editing desktop-only** (the larger-screen toast). Responsive
  drag/resize editing was built and reverted (90a7e1da).
- **`react-grid-layout` `compactType: 'vertical'`,
  `preventCollision: false`.** Other values silently break resize
  handles (582b3a85, 1685ff90). The ref-callback cache never evicting on
  null and refs placed one level inside grid children are the c8d0d833
  lessons; keep both.
- **The MJPEG data-URL workaround scoped to WebKitGTK only, and Tauri
  blob-URL thumbnails as a separate path.** Platform-specific by design;
  do not extend or unify.
- **Global reduced-motion neutralizer freezing spinners.** Deliberate; a
  frozen spinner still reads as loading. Only the alarm pulse loses its
  information when frozen (P8-3 adds a static fallback; it does not
  weaken the global rule).
- **`GeminiNanoPlugin.cancelChat` abandoning instead of cancelling.**
  `future.cancel(true)` crashes the process via the ML Kit/coroutines
  `NoSuchMethodError`, observed on device; the ponytail comment names
  the upgrade path.
- **iOS safe-area recomputation in `main.tsx` and the absence of JS
  orientation handlers.** Both are documented WKWebView workarounds;
  orientation handlers were tried and reverted twice (d1112e17,
  54af0cfe).
- **WebLLM gated off on iOS; llama.cpp absent on Android.** The 2GB
  jetsam limit and the measured #270 removal respectively.
- **Advisory full lint (`continue-on-error`) in CI.** Deliberate,
  backstopped by the hard ratchet step in the same required job (C7
  enforced).
- **Node/qemu pin on linux-arm64.** No longer exists; the workflows run
  native ARM with Node 22. The stale playbook entry is the finding
  (P9-4), not the workflow.
- **Empty catch bodies across production code.** All 25 justified and
  commented; the sweep confirmed no silent data loss behind any.
- **API-derived capability skips in e2e** (`serverHasEvents`, `hasPTZ`)
  and `.wip` features counting as step references. Sanctioned testing
  playbook patterns; P5 targets only UI-derived guards.
- **Aggregation contract's "Gate: review".** Honest labeling with
  mechanization tracked; the model the other Gate lines should follow
  where mechanization is not cheap.
- **`ALL_PROFILES_ID` legacy arms** in the rehydrate migration and the
  notifications display arm; both are the contract's allowed
  exceptions.
- **Monitors' always-visible subtitle** (a live count, deliberately kept
  on phones); any PageHeader extraction carries it as a prop.
- **Electron shell trusting any cert with no pinning.** Documented
  in-file as an experimental shell with an explicit do-not-promote
  note; hardening ahead of that decision is speculative.

## Phased execution plan

Ordered by risk reduced per unit of effort. Each item names its finding
IDs. Enforcement gates land against current behavior first, hardening
after, so no phase turns the tree red by construction.

### Phase 1: enforcement gates and cheap confirmed defects (CI-verifiable, all S unless noted)

1. **P4-1/P3-2**: fix `download.ts` store import (gate injection) and
   add the services-to-stores direction assertion, proven red first.
2. **P5-4**: `waitForTimeout` ratchet gate in `e2e-steps.test.ts`,
   seeded with the 43 current sites; proven red before allowlisting.
3. **P9-2**: give lint-staged a config or delete the call, dependency,
   and comment.
4. **P9-3**: run `scripts/__tests__` in the native-version-guard job;
   prove red by breaking the guard locally.
5. **P9-1** (loud-skip form): make the skipped e2e job say so in both
   workflows.
6. **P4-4/P3-6**: `max-lines` ratchet entry; baseline regenerated, no
   splits.
7. **P9-5**: `npm audit fix` both lockfiles plus the two deliberate
   bumps; `npm run gates` and one local e2e feature after (M).
8. **P9-6**: SHA-pin the six third-party action references; verify one
   platform via manual dispatch.
9. **P1-1, P1-2, P1-8, P9-7, P9-8**: the one-liners (dead ternary,
   HelpRow hoist, scrubber constant, tsx devDependency, tauri gitkeep).

### Phase 2: e2e trust restoration (sequencing matters)

10. **P5-5**: extend the step gate to reachability, proven red against
    the current step files. Land the gate with the current offenders
    allowlisted or in the same change as their fixes, never before.
11. **P5-1, P5-2, P5-3, P5-6, P5-8**: hard-assert the conditional-pass
    steps the gate now flags. P5-2 is one deleted line. Expect newly
    honest reds against the shared demo server; triage against the #342
    baseline, not zero.
12. **P5-7**: assert the video player specifically.

### Phase 3: confirmed user-facing defects in app code

13. **P11-1 + P11-2** (one PR): notifications schema plus surfaced
    registration failure and outcome-derived status; locale keys in all
    five locales; device pass for the real push round-trip rides
    Phase 6.
14. **P3-3**: theme-provider and LiveMonitorPlayer onto the
    merge-in-useMemo template; red-first default-propagation test.
15. **P6-3/P3-4**: MontageMonitor raw-slice selector plus the
    real-store regression test (red via a temporary minting default).
16. **P6-1 + P6-5** (one commit): stable pin-toggle callback and
    memoized maps, with the render-count test red first.
17. **P6-2**: imperative pinch transform; render-count probe red first;
    feel confirmed in Phase 6.
18. **P6-4**: hoist theme-color resolution out of the paint loop.
19. **P1-5**: Logs server-log fetch onto React Query with the
    stale-response test red first.
20. **P8-1 + P8-2** (one PR): cream/slate/destructive token fixes plus
    the token-contrast vitest proven red against current cream values.
21. **P8-3**: reduced-motion alarm tint plus ARIA exposure; five locale
    keys; unit test red first; tint appearance checked in Phase 6.
22. **P8-4**: enable the two a11y rules; label the nine test mocks.
23. **P11-3, P11-4, P11-6, P8-6**: the small hardening set (three
    withFieldCatch wraps, two isAbortError swaps, one record schema,
    one TV WARN).

### Phase 4: instruction-system and documentation truth (protocol edits)

24. **P10-1**: rewrite the four chapters onto the sessions path and add
    the forbidden-symbol doc scan (red first). Highest-value doc work.
25. **P10-2, P10-4**: the two flow-step corrections and the one-word
    rename.
26. **P9-4**: correct the qemu/Node-18 playbook entry (protocol PR).
27. **P3-5**: narrow the Auth contract token clause (protocol PR).
28. **P3-1/P4-3**: mechanize the cheap contract greps in
    `agents-contracts.test.ts` (each proven red with a scratch
    violation) and reword the remaining Gate lines to the honest form
    (protocol PR). Also fold in the P1-8 constants-gate note.
29. **P3-7**: fix the seven stale rule-ID comments; optionally extend
    the ID scan to `src/tests`.
30. **P10-3**: strip the `#L` anchors in one mechanical pass and gate
    them out (L by count, mechanical).
31. **P1-4**: formatter config plus the isolated whitespace-only
    reformat commit of the nine files.
32. **P3-8**: name the six UI ticks or add the contract exception; one
    or the other, not both.

### Phase 5: DRY consolidation (behavior-preserving refactors)

33. **P2-2**: `eventPath`/`monitorPath` helpers replacing 15 inline
    templates (worst defect-history subsystem).
34. **P2-1**: `ProfileErrorStrips` replacing the four copies, exact
    testids preserved.
35. **P2-6** (minimal form): six `buttonVariants` swaps plus
    DeleteBatchBar's variant.
36. **P2-5**: three duration-format sites onto `formatElapsedShort`
    (new sub-minute branch red-first in the helper's tests).
37. **P2-3**: capability-probe factory behind the three existing hook
    names.
38. **P1-3, P1-7, P2-4, P2-7, P4-5**: opportunistic extractions
    (cause badge, token-freshness helper, PageHeader, ListPageSkeleton,
    PipContext move) when their files are next open; none earns a
    dedicated PR.

### Phase 6: device-only batch (one session, real hardware)

Batch all device-pass-required items into one iOS plus one Android
session; none is CI-verifiable.

39. **P7-1**: iOS cert-fetch completion fix. Scenarios: http portal
    save errors instead of spinning; bootstrap proceeds with the server
    off.
40. **P7-2**: Android hostname/pin ordering fix. Scenarios: pinned
    self-signed still works; CA-valid cert for another name rejected on
    the pinned host; CA-valid profile unaffected. Document accepted
    risk if IP-access-to-SAN-cert users are affected.
41. **P7-3**: Gemini Nano download guard (AICore device).
42. **P7-5 + P7-4**: dead iOS 15 branches and stale comments, riding
    the same build.
43. **P7-6**: the four synchronization fixes, with a TOFU plus download
    regression pass.
44. **P8-5**: the three touch targets, visual check.
45. **P4-6**: profile-store Preferences adapter and migration (M);
    adapter and migration unit tests are CI-side and red-first, but
    rehydration timing and durability are device-verified. Last in the
    batch because it touches root user data (I2): verify the migration
    on a device with existing profiles before merging.
46. **P11-1/P11-2 and P8-3 device confirmations** from Phase 3.

Deferred indefinitely (from the pillar not-worth-it lists): file splits
for C2, store-to-Preferences beyond the profile store, DI frameworks,
madge parity, full ConfirmDialog and page-framework abstractions,
axe-core e2e, e2e fixture-server architecture, per-page All-mode doc
duplication, chapter renumbering, hard-gating full lint before the
backlog burns down.

## Notes for the executing agent

- **Process**: P1 applies: create or use an issue before this work and
  land through issue-linked PRs; closing keywords only after the
  maintainer confirms. P5: one logical change per conventional commit;
  the Phase 1 items are separate commits, not one sweep. P8: never
  merge the default branch without approval.
- **Tests first**: every behavior change above names its red-first test
  (P2). Refactors with no behavior change (Phase 5) rely on existing
  gates per P2's second clause; do not manufacture vacuous tests for
  them. Prove every new gate red before allowlisting or fixing.
- **Per-commit gates**: run what the change touches; full
  `npm run gates` once per wave at push time. Run vitest only from
  `app/`, never the repo root. Never pipe a gate through a filter.
  When a change alters a settings shape, also run the suites that
  consume that shape (testing playbook).
- **E2e**: only one `npm run test:e2e` per working tree. Five
  events-filter scenarios are bisect-proven pre-existing failures
  (#342); triage new failures against that baseline, not zero. Device
  e2e (iOS, Android, Tauri) is manual-only; never auto-run it.
- **Native**: `npm run ios:sync`/`android:sync` bump native versions;
  revert incidental bumps before commit, and make intended bumps
  standalone `chore:` commits. Every Phase 6 item needs its device
  scenarios recorded in the PR or handoff per the native playbook.
- **Instruction files**: the Phase 4 protocol items (P9-4, P3-5, P3-1
  rewording, P1-8 note) edit `AGENTS.project.md` or
  `agents/project/*.md`; they go through the self-improvement protocol
  as part of the PR fixing the related code, never as drive-by edits.
- **Locales**: new user-facing strings (P11-2, P8-3) update all five
  locales together (C3); edit locale keys individually, never by bulk
  sed (a sed once broke 15 pluralized strings; domain playbook).
- **Do not touch**: anything in Non-findings above; in particular do
  not refactor `useStreamLifecycle`, re-attempt list virtualization,
  extend the WebKitGTK workarounds, alter the TOFU accept-before-pin
  onboarding arm beyond the P7-2 hostname/pin ordering, or weaken the
  global reduced-motion rule while fixing P8-3.
- **GitHub identification**: issue and PR comments identify as Claude
  assisting @pliablepixels with the project's exact line; commits do
  not.
