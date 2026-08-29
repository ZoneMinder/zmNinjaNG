# Fable codebase review, 2026-08-29

Reviewer: Claude (Fable 5), orchestrating twelve Fable pillar agents, each
read-only with a fresh context and a written brief. Every finding below was
confirmed by the orchestrator re-reading the cited source before publication;
claims the orchestrator could not confirm were dropped, not softened. Each
pillar agent also re-checked every finding of the 2026-08-06 review for its
pillar and reports it as fixed, open, or never valid.

Scope: `app/src` (468 production files, 81,284 lines; 361 unit-test files,
72,441 lines), `app/tests` e2e (61 files, 8,761 lines), native shells
(iOS Swift 2,011 lines, Android 1,674 lines, Electron 781 lines), `docs/`
(86 files, 40,979 lines), 15 GitHub workflows, husky hooks, both package
manifests, and the instruction system (`AGENTS.md`, `AGENTS.project.md`,
`agents/**`, `.claude/skills/**`, 1,177 lines).

Excluded: `node_modules`, generated output (`docs/_build`, `dist`,
`.features-gen`), locale file content beyond parity checks, `images/`, the
Tauri remnants (`desktop_release_builds/tauri/.gitkeep` and one `.wip`
feature, examined only for gitignore state), and `CHANGELOG.md`.

Skipped by instruction: Pillar 12 (Security) was offered to the maintainer
and declined for this run, as on 2026-08-06. It is recorded as not assessed,
not zero. Security-adjacent defects found by other pillars (token in iOS
extension logs, Android pin bypass, mutable release-action tags) are reported
under those pillars.

New this run: Pillar 13 (Instruction system overhead), added to the review
skill on 2026-08-29 (a5e69c49). It scores whether the contracts, gates, and
playbooks cost more than they catch; it has no prior-review baseline.

Scoring: this is the first run under the rubric added to the skill in
a5e69c49 (HIGH caps a pillar at 7.0, three HIGH at 5.0, each MED minus 0.5,
each LOW minus 0.2, theoretical findings not counted). The 2026-08-06 scores
were impressions. Where a pillar moves more than 1.0, the scorecard row says
whether findings or the rubric moved it.

Repository state at review time: branch `fix/391-instruction-overhead`,
clean working tree, HEAD `cf2dda39`. The branch is one commit of skill
documentation ahead of `main` and touches no application code, so the
findings apply to `main` unchanged. 108 commits have landed since the prior
review.

## Scorecard

| Pillar | Score | Prior | Verdict |
|---|---|---|---|
| 1. Code clarity | 6.9 | 8.3 | Why-comments and named phases remain strong; seven of eight prior findings open, the 4-space fork grew from 9 to ~17 files. Drop is the rubric: three MED and eight LOW confirmed, none new in kind |
| 2. DRY and reuse | 7.8 | 7.4 | Shared primitives adopted where they exist; error strips still copied four ways with shipped drift, deep-link templates grew 15 to 17 sites |
| 3. Contract and rule adherence | 7.1 | 8.1 | Gated clauses hold at zero violations; eleven Gate lines still name a test that asserts none of their Never clauses, and one direct Service-boundary breach has now passed two reviews green |
| 4. Architecture and modularity | 8.7 | 7.9 | Static graph acyclic and gated, query keys disciplined; one static service-to-store import, C2 ungated at 54 files. Rise is the rubric: one confirmed MED, the localStorage durability item is theoretical |
| 5. Test quality and automation trust | 4.2 | 7.0 | All eight prior findings open, two of them HIGH conditional-pass chains on the onboarding journey; the Then-assertion gate still checks presence, not reachability. Drop is two HIGH plus four MED under the rubric |
| 6. Runtime performance | 7.4 | 8.3 | Montage memo barrier still voided by one closure, pinch still re-renders the page; new: scrubber reconciles one DOM node per event per pan frame |
| 7. Native platform integration | 4.7 | 7.8 | iOS cert-fetch hang (HIGH) and Android pin bypass unchanged; new: the notification extension logs the tokenized image URL four times and the native-logging rule is still ungated. Drop is the HIGH cap plus three MED |
| 8. Accessibility and UX robustness | 7.9 | 8.1 | Gate clean, 91/91 icon buttons named, TV and offline paths verified; cream and destructive contrast still fail AA, alarm state still invisible under reduced motion, `ErrorBanner` is not a live region |
| 9. Build, CI, dependency health | 7.6 | 7.9 | Two prior findings fixed (lint-staged config, script tests in CI); proven-red still not required, audit count rose from 22 to 37 with no dependabot |
| 10. Documentation and handover | 4.9 | 7.4 | All four prior findings open; new HIGH: `applySSLTrustSetting` cited at seven sites and does not exist. Drop is two HIGH plus three MED under the rubric |
| 11. Error handling and trust boundaries | 8.4 | 8.8 | Systematic schema tolerance and destructive-path recovery; `api/notifications.ts` still unvalidated, `instanceof DOMException` checks grew from 2 to 5 |
| 12. Security | not assessed | not assessed | Skipped by maintainer instruction for this run |
| 13. Instruction system overhead | 5.0 | none | Word budget, hash checks, and the Sessions gate are the template; the P1 acceptance-lines clause is gated on a template file and ignored by 4/4 PRs since it landed, eleven Gate lines are fiction, proven-red does not block |

**Overall: 6.7 / 10** (mean of the twelve assessed pillars). The 2026-08-06
overall was 7.9 under impression scoring. Applying this run's rubric to the
prior run's own findings would have produced a similar number; the code has
not regressed by 1.2 points. What has changed is that 47 of the prior run's
59 findings are still open, six grew, and four of the twelve new findings
this run are the same defect classes recurring in new sites.

## Gates

All gates were run bare from `app/`, exit codes checked directly.

| Command | Result | Raw counts |
|---|---|---|
| `vitest run` | pass | `Test Files 360 passed \| 1 skipped (361)`, `Tests 4221 passed \| 2 skipped (4223)` |
| `npm run build` (`tsc -b && vite build`) | pass | `✓ built in 25.66s`, chunk-size warnings only |
| `npm run lint:a11y` | pass | 0 problems |
| `npm run lint:correctness` | pass | 0 problems |
| `npm run lint:ratchet` | pass | `Lint backlog within baseline: 201 problems across 12 rules.` |

Supplementary probes: `npx madge --circular` reports 4 cycles, all the
sanctioned `await import()` breaks (see Non-findings). `npm audit` in `app/`:
`37 vulnerabilities (1 low, 7 moderate, 28 high, 1 critical)`; at the repo
root: `19 vulnerabilities (1 low, 1 moderate, 17 high)`. Branch protection on
`main` (`gh api`): required contexts `unit-tests, lint, build, lint-a11y,
lint-react-correctness, native-version-guard`; `allow_auto_merge` is true.
PR bodies 387 through 390 (`gh pr view --json body`): zero contain
`## Acceptance`.

## Cross-cutting themes

Four themes explain most of the lost points.

### Nothing from the prior review was executed

The 2026-08-06 review produced 59 findings and a phased plan. Twelve are
fixed or partly fixed (P1-1, P2-4 mostly, P8-5 one of three sites, P9-1 in
one of two workflows, P9-2, P9-3). The rest are open at the same lines, and
six moved the wrong way: four-space files 9 to ~17 (P1-4), deep-link
templates 15 to 17 (P2-2), files over 400 lines 52 to 54 (P3-6), `instanceof
DOMException` sites 2 to 5 (P11-4), audit vulnerabilities 22 to 37 (P9-5),
and PageContainer bypasses widened to 11 wrappers (P2-7). The 108 commits in
between were feature and fix work on all-profiles, streaming, and the
assistant; none referenced a review finding ID. A review whose plan is not
scheduled is a cost, not a control; the phase plan at the end of this report
is ordered so that the first two items take under an hour and close the
highest-severity gaps.

### Gates measure the wrong thing, and rules without gates drift

The prior review's central theme reproduces exactly. Where a mechanized gate
exists, discipline is measured near-perfect: zero raw fetches, zero console
calls in app code, zero inline query keys, zero unnamed icon buttons, zero
literal date patterns, sessions fully clean. Where a rule is script-checkable
but ungated, it drifted every time, and every ungated count that the prior
review measured is larger now. The new instances this run are gates whose
green means less than it reads: eleven contract Gate lines cite
`agents-contracts.test.ts`, which asserts none of their Never clauses
(P13-1); the P1 acceptance-lines rule is gated on the PR template file
existing, not on any PR body, and 4/4 PRs since it landed ignore it (P13-2);
the proven-red job runs on every PR and blocks nothing (P13-3, P9-1); the
Then-assertion gate passes a step that returns before its `expect` (P5-5);
the native-logging rule the playbook calls ungated is now violated on the
second platform (P7-1, P7-2). The fix pattern is unchanged from last time:
grep-style assertions modeled on the Sessions block, ratchets seeded with
current counts, and honest `Gate: review.` wording where mechanizing needs
judgment.

### The developer guide teaches code that does not exist

Four chapters still teach the retired HTTP singleton (P10-1, 16 sites), and
this run found a second retired API cited at seven sites: `applySSLTrustSetting`
(P10-5), which has never existed in the current tree; the real function is
`applyTrustedCertificates`. Two call-flow steps describe an auth-gated single
query that the all-profiles work replaced with a scoped hook whose inline
comment warns against exactly that gate (P10-2, P10-6). No test scans
developer docs for symbol truth; `agents-contracts.test.ts` scans `app/src`
only. One forbidden-symbol test over `docs/developer-guide/*.rst` closes the
whole class.

### The same defect class recurs in new sites

Where the prior review found a pattern, this run found it again in code
written since: three new `instanceof DOMException` checks beside the helper
that exists for them (P11-4); five disjunctive Then steps that pass on any
rendered app shell, in files the prior review did not audit (P5-9); two more
deep-link templates (P2-2); two files written after the review in 4-space
indentation (P1-4); a second hand-rolled empty state (P2-8). Agents told to
match existing style match the drift. Each is cheap to fix and cheaper to
gate; the executor should land the gate in the same commit as the fix so the
count cannot regrow before the next review.

## Pillar 1: Code clarity (6.9/10)

Paths in this section are relative to `app/src/`.

Strengths verified:

- Why-comments carry the incident at the site: `hooks/useEventFilters.ts:167-186` explains the `currentProfileId` keying (#337) and the synchronous hydrate (#197); `useStreamLifecycle.ts` carries 7 `refs #`, `LiveMonitorPlayer.tsx` 10, `AskPanel.tsx` 29.
- The raw-versus-wrapped setter idiom is documented where it is defined (`useEventFilters.ts:172-177`).
- Zero `TODO|FIXME|HACK|XXX` in `pages components hooks lib stores services`; deferred work is 14 `ponytail:` markers, each naming the ceiling.
- Zero nested ternaries in `.tsx` outside two parenthesized cases.
- Phase state is named where a flow has stages (`AssistantOllamaSection.tsx:52` `testStage`).
- Prior P1-1 (dead ternary in `QRScanner.tsx`) is fixed.

### P1-1  Dead ternary in TagChip remove button

- **Severity:** LOW, confirmed
- **Site:** `components/events/TagChip.tsx:81`, `TagChip` remove `HintButton` className: `size === 'sm' ? 'p-0.5' : 'p-0.5'`
- **What is wrong:** Both arms identical. Same shape as the prior review's fixed P1-1; this one landed 2026-08-02 (b23943ac).
- **Why it matters:** A reader hunts for a size difference that does not exist; the next edit guesses a value for the other arm.
- **Fix:** `'p-0.5'` alone, or the intended `size === 'sm' ? 'p-0.5' : 'p-1'`; the sibling `cn()` size branches in the same file show the intended shape.
- **Verification:** `npm run build` plus existing events tests; cosmetic, no new test.
- **Effort:** S (1 site)
- **Risk:** none, CI-verifiable
- **Contracts:** C2

### P1-2  Component defined inside a JSX IIFE

- **Severity:** LOW, confirmed (prior P1-2, open)
- **Site:** `components/timeline/TimelineToolbar.tsx:133-152`, `HelpRow` inside `{(() => { ... })()}` in `PopoverContent`
- **What is wrong:** `HelpRow` is a new component identity each render, so the seven rows remount whenever the toolbar re-renders with the popover open; `hasPointer` (`:134`) re-runs `window.matchMedia` per render.
- **Why it matters:** Canonical component-in-render anti-pattern; also hides the `#00a8ff` literal (P1-8) inside the IIFE.
- **Fix:** Hoist `HelpRow` to module scope as `LogCodeBlock` is in `pages/Logs.tsx:43`; compute `hasPointer` once.
- **Verification:** `npm run gates`; existing timeline e2e covers the help popover text.
- **Effort:** S (1 site)
- **Risk:** none, CI-verifiable
- **Contracts:** C2

### P1-3  Event-cause badge re-implemented as a JSX IIFE at six sites

- **Severity:** LOW, confirmed (prior P1-3, open, unchanged count)
- **Site:** `NotificationHandler.tsx:242-243`, `dashboard/widgets/EventsWidget.tsx:189-190`, `events/EventCard.tsx:287-295`, `NotificationHistoryItem.tsx:151-152`, `useNotificationAllModeToasts.tsx:82-83`, `events/EventMontageView.tsx:235`; each calls `getEventCauseIcon` inside an IIFE to bind a local
- **What is wrong:** Same icon-plus-label block hand-copied; `pages/EventDetail.tsx:423-425` already shows the `useMemo` idiom with a why-comment.
- **Why it matters:** Six places to change a badge; the IIFE form is the least readable way to bind one const.
- **Fix:** `EventCauseBadge` in `components/events/` (C5), or hoist each `CauseIcon` above the `return` as `EventDetail` does.
- **Verification:** `npm run gates`; existing cause-text assertions cover the extraction.
- **Effort:** M (6 sites, styling varies)
- **Risk:** subtle styling drift; CI-verifiable
- **Contracts:** C1, C5

### P1-4  Four-space files in a two-space codebase, still ungated and growing

- **Severity:** MED, confirmed (prior P1-4, open and grew)
- **Site:** `pages/Logs.tsx`, `pages/Dashboard.tsx`, `components/theme-provider.tsx`, `components/dashboard/{WidgetEditDialog,DashboardConfig,DashboardLayout,DashboardWidget}.tsx`, `components/dashboard/widgets/{MonitorWidget,EventsWidget,TimelineWidget}.tsx`, `stores/logs.ts`, `stores/dashboard.ts`, `types/notifications.ts`, `lib/time.ts`, `lib/grid-utils.ts`, `services/profile.ts`, `contexts/PipContext.tsx` (mixed). No `.prettierrc`, `.editorconfig`, or ESLint `indent` rule exists in `app/` or root (verified by `ls`).
- **What is wrong:** The prior review counted nine; the count is now ~17. `lib/time.ts` (2026-08-03) and `services/profile.ts` (2026-08-04) postdate that review, so agents told to match existing style are propagating the fork.
- **Why it matters:** Cross-cutting diffs stay noisy; M1 says an ungated checkable rule drifts, and this one measurably did.
- **Fix:** One whitespace-only `chore:` reformat (P5), plus `.editorconfig` with `indent_size = 2` at minimum, or a Prettier config wired into `npm run lint`, so the rule is gated.
- **Verification:** `git diff -w` empty for the reformat commit; `npm run gates`.
- **Effort:** M (~17 files, isolated commit)
- **Risk:** blame churn; CI-verifiable
- **Contracts:** M1, P5

### P1-5  ZM server logs fetched with raw useEffect and useState

- **Severity:** MED, confirmed defect shape; race theoretical (prior P1-5, open)
- **Site:** `pages/Logs.tsx:105-137`, `Logs` `zmLogs`/`isLoadingZmLogs` state and the `useEffect` calling `getZMLogs(getSession(currentProfile.id).client, ...)`
- **What is wrong:** The only server fetch in the app outside React Query. No cancellation or staleness guard: switching the picked profile mid-flight lets the old profile's response land in `zmLogs` after the new request started. No error state beyond a toast, no caching, and an `eslint-disable-next-line react-hooks/exhaustive-deps`.
- **Why it matters:** On the server-scoped Logs page a user can briefly read one server's logs attributed to another; it is also the one place a reader meets a different data-fetch idiom.
- **Fix:** `useQuery` keyed from `lib/query/query-keys.ts` with `asProfileId`; loading and error via `ErrorBanner`/`resolveQueryError` (`components/ui/query-state.tsx`).
- **Verification:** New unit test proven red pre-fix (resolve A's fetch after switching to B, assert B's logs render), then `npm run gates`.
- **Effort:** M (1 page; loading, empty, and error branches near `:577`)
- **Risk:** refetch cadence changes; CI-verifiable
- **Contracts:** Server queries, Query UI states, C1, P2

### P1-6  Side effect inside a setState updater

- **Severity:** LOW, confirmed pattern; failure theoretical, dev-mode (prior P1-6, open; file moved)
- **Site:** `components/timeline/useTimelineViewport.ts:96-127`, `animateToRange`: `setRangeState((prev) => { ... animFrameRef.current = requestAnimationFrame(tick); return prev; })`
- **What is wrong:** The updater starts a rAF loop and returns `prev`. Updaters must be pure; StrictMode double-invokes and schedules two easing loops fighting over `animFrameRef`.
- **Why it matters:** A reader expects an updater to compute state, not schedule work; the comment `// don't change yet, animation handles it` is the tell.
- **Fix:** Read the current range from a ref (the hook already keeps refs for gestures) and start the loop outside the updater.
- **Verification:** Unit test invoking the updater twice with mocked rAF, proven red pre-fix; `npm run gates`.
- **Effort:** S (1 site)
- **Risk:** one skipped frame on a concurrent pan; CI-verifiable
- **Contracts:** P2

### P1-7  Unnamed token-freshness expression at nine sites

- **Severity:** LOW, confirmed (prior P1-7, open; grew from 8 to 9)
- **Site:** `isFresh ? accessToken ?? undefined : undefined` at `NotificationHandler.tsx:213`, `monitors/MonitorRecentEvents.tsx:68`, `timeline/TimelineScrubber.tsx:111`, `NotificationHistoryItem.tsx:63`, `pages/Events.tsx:745,760`, `pages/EventDetail.tsx:651`; nested owner variant at `events/EventListView.tsx:91` and `events/EventMontageView.tsx:115`
- **What is wrong:** A real auth rule ("only pass a token the store says is fresh") with no name; the `?? undefined` coercion is the non-obvious part and is retyped each time.
- **Why it matters:** A reader cannot tell whether `?? undefined` is load-bearing without reading the auth store.
- **Fix:** One selector or helper beside the auth store's freshness selector (`stores/auth.ts:687` shows the shape), replacing the nine mechanical sites.
- **Verification:** `npm run gates`; `stores/__tests__/auth.test.ts` already covers freshness.
- **Effort:** M (9 sites)
- **Risk:** none if `?? undefined` is preserved; CI-verifiable
- **Contracts:** C1; Auth tokens in spirit

### P1-8  Scrubber accent colour inline at three sites

- **Severity:** MED, confirmed (prior P1-8, open)
- **Site:** `timeline/TimelineToolbar.tsx:144` (legend swatch), `timeline/TimelineCanvas.tsx:294` (`ctx.strokeStyle`), `timeline/TimelineScrubber.tsx:450` (`backgroundColor`), all `#00a8ff`
- **What is wrong:** One semantic colour, three literals; the legend swatch exists only to match the other two. No constant exists (grep for the hex returns exactly these three).
- **Why it matters:** Change one and the help legend lies. The Constants gate passed while this drifted, so the gate is blind to inline colours (M2).
- **Fix:** Named constant in `lib/zmninja-ng-constants.ts` imported at all three.
- **Verification:** `npm run gates`.
- **Effort:** S (3 sites)
- **Risk:** none; CI-verifiable
- **Contracts:** C4, Constants, M1, M2

### P1-9  Unnamed state machines expressed as boolean clusters

- **Severity:** LOW, confirmed (new)
- **Site:** `components/settings/AdvancedSection.tsx:73-79` with transitions at `:94-97`, `:106-110`, `:113-117`, `:141-149`, `:152-154`, `:159-160`, `:167-169`, `:175-178` (`showPinPad`, `pinPadMode`, `pendingPin`, `pinError`, `pendingAction`); `components/QRScanner.tsx:49-53,323` (six flags; reset blocks at `:107-112` and `:285-288` clear different sets); `pages/ProfileForm.tsx:48-50` (`testing`, `error`, `success`)
- **What is wrong:** Legal combinations are implicit; the reader reconstructs the state chart from setter call sequences. The two QRScanner reset blocks already disagree on `hasPermission`/`scannerReady`.
- **Why it matters:** Each new transition is another place to forget a flag, the same leak class the domain playbook records for per-visit state (`agents/project/domain-context.md`, the `MonitorDetail`/`EventDetail` entry).
- **Fix:** One discriminated union per flow; in-repo example of a named stage is `AssistantOllamaSection.tsx:52` (`testStage`). Keep `hasPin` and `certInfo` separate.
- **Verification:** Existing PIN pad and QR scanner tests cover transitions; add one proven-red test per collapsed flow asserting an illegal combination cannot render.
- **Effort:** M (3 files, ~25 setter sites)
- **Risk:** behavior-preserving refactor of dialogs; CI-verifiable, QR native path device-only
- **Contracts:** C2, P2

### P1-10  Raw and wrapped setter idiom undocumented in its second copy

- **Severity:** LOW, confirmed (new)
- **Site:** `hooks/useTimelineFilters.ts:50-91` (`_setMonitorIds` raw, `setSelectedMonitorIds` wrapped with `saveFilterField`)
- **What is wrong:** Same `_set*`/`set*` pairing as `useEventFilters.ts:172-186` without the block that says the raw setters exist only for restore paths; `useTimelineFilters` also restores in an effect (`:87-95`) where `useEventFilters` hydrates synchronously (#197), and the difference is unexplained.
- **Why it matters:** A reader of the Timeline hook alone may wire a user action to `_setX` and silently lose persistence.
- **Fix:** A one-line pointer comment to `useEventFilters`, and a sentence at `:87` if the async restore is deliberate.
- **Verification:** doc-only change; `npm run gates` if extracted.
- **Effort:** S (1 site)
- **Risk:** none
- **Contracts:** P10

### P1-11  Remaining JSX IIFEs that a local or `&&` would replace

- **Severity:** LOW, confirmed (new)
- **Site:** `components/profile-switcher.tsx:152-160` (try/catch `new URL(profile.portalUrl).hostname` inside JSX); `pages/Logs.tsx:602-612` (an `if ... return <span>; return null` IIFE); `components/monitors/MontageMonitor.tsx:417-440` (IIFE only to bind `player`)
- **What is wrong:** IIFE used as a let-binding. Nine JSX IIFEs remain in the codebase; these three plus P1-2 and the P1-3 group account for all of them.
- **Why it matters:** Reader parses a function call to discover a one-line conditional.
- **Fix:** Hoist to a `const`/`useMemo` above `return`, per `EventDetail.tsx:423-425`; `LiveMonitorPlayer.tsx:280-286` already parses a hostname above its return.
- **Verification:** `npm run gates` (no behavior change).
- **Effort:** S (3 sites)
- **Risk:** none; CI-verifiable
- **Contracts:** C1, C2

Path to 10/10.

Worth it: P1-4 (formatter config plus one reformat commit; the count grew, so the gate is the fix), P1-5 (the one user-visible defect), P1-8, the one-liners P1-1, P1-2, P1-11, and P1-9 for `AdvancedSection` and `QRScanner` (the two flows with disagreeing reset blocks).

Not worth it: P1-9 for `ProfileForm` alone (three flags, one handler, readable as-is); rewriting `useStreamLifecycle` into a named state machine (every branch maps to a documented incident and the refactor risk is the recurring regression class); collapsing `LiveMonitorPlayer`'s watchdog refs (device-only verification); deduplicating near-miss token ternaries outside the nine exact sites; a blanket no-IIFE-in-JSX lint (after P1-2, P1-3, P1-11 nothing is left to catch, and it would block the legitimate early-return guard shape).

## Pillar 2: DRY and reuse (7.8/10)

Paths in this section are relative to `app/src/`.

Strengths verified:

- `ErrorBanner` with `resolveQueryError` (`components/ui/query-state.tsx:23`) is the only error-state primitive in pages: six page sites, no ad-hoc error markup.
- `DetailPageSkeleton` adopted by both detail pages; `EmptyState` used in 9 files; `RefreshButton` adopted by six surfaces; `PageContainer` by eight pages.
- `formatElapsedShort` (`lib/format-date-time.ts:116`) is the single home for elapsed formatting.
- The three scoped fan-out hooks share the `useQueries` plus `combine` template and differ only in query key, so no extraction is warranted.
- Since the prior review, 900bd236 and 4c6f2ecd moved the page-title cluster onto one recipe at 9 of ~13 page h1 sites (prior P2-4 mostly fixed).

### P2-1  Per-profile error strip copied at four sites with shipped drift

- **Severity:** MED, confirmed (prior P2-1, open)
- **Site:** `pages/Monitors.tsx:405-434`, `pages/Timeline.tsx:421-446`, `components/events/EventsAllModeBar.tsx:52-76`, `components/montage/MontageGridSections.tsx:51-79` (`MontageErrorStrips`, whose comment says it "deliberately mirrors Monitors.tsx"). The `visibleErrors` predicate repeats at `Monitors.tsx:248`, `Events.tsx:319`, `Timeline.tsx:164`, `Montage.tsx:541`; `allFailed` at `Monitors.tsx:241`, `Events.tsx:316`, `Timeline.tsx:163`.
- **What is wrong:** Same row div, same `profile-error-strip-${id}` testids, same `ErrorBanner` message join, same Retry button, four times. Only Monitors (`:416-419`) drops the profile-name prefix when `totalScopeProfiles === 1`; the other three always prefix (verified by reading both sites).
- **Why it matters:** Single-server users on Timeline, Events, and Montage see "MyServer: Failed to load" while Monitors shows "Failed to load"; any future strip change has four places to miss.
- **Fix:** Promote `MontageErrorStrips` to `components/common/ProfileErrorStrips.tsx` with `{ errors, onRetry, fallbackKey, singleProfile? }`, keep testids verbatim, render it at all four sites; optionally a `visibleProfileErrors` helper for the predicate.
- **Verification:** Existing all-mode e2e keys on the testids; `pages/__tests__/Monitors.test.tsx:286` and `Events.test.tsx:733` cover `all-failed-state`. The single-profile prefix unification is a behavior change on three pages: one unit test asserting the unprefixed message on Timeline single mode, proven red first (P2).
- **Effort:** M (4 render sites, 4 predicate sites)
- **Risk:** testid or message-join regression; CI-verifiable
- **Contracts:** C1, C3, Query UI states

### P2-2  All-mode deep-route template hand-built at 17 sites

- **Severity:** MED, confirmed (prior P2-2, open, grew from 15)
- **Site:** `components/CommandPalette.tsx:145`, `components/KeyboardShortcuts.tsx:122`, `components/monitors/MonitorCard.tsx:129`, `components/montage/MontageGridSections.tsx:203`, `components/live-activity/LiveActivityTile.tsx:97`, `components/dashboard/widgets/MonitorWidget.tsx:78`, `components/dashboard/widgets/EventsWidget.tsx:170`, `components/events/CompactEventRow.tsx:64`, `components/events/EventCard.tsx:86`, `hooks/useEventNavigation.ts:60`, `lib/navigation.ts:51`, `lib/assistant/server-scope.ts:101-102`, `pages/Montage.tsx:396`, `pages/NotificationHistory.tsx:85`, `pages/Timeline.tsx:111`, `pages/EventDetail.tsx:563`, `pages/hooks/useMonitorNavigation.ts:52`
- **What is wrong:** `profileId ? \`/all/events/${profileId}/${id}\` : \`/events/${id}\`` and the `/monitors` twin inlined 17 times (18 grep hits including one two-line site); `lib/navigation.ts` owns the route grammar but exports no path builder. `useMonitorNavigation.ts:52` has a local `monitorPath` closure showing the shape wanted.
- **Why it matters:** These are the deep links whose bare-id class produced the #337 defect chain (domain playbook). A route rename or third param is a 17-site edit.
- **Fix:** Export `eventPath(id, profileId?)` and `monitorPath(id, profileId?)` from `lib/navigation.ts`; replace the inline templates, keeping each site's `navigate` state payload.
- **Verification:** One unit test on the two branches of each helper (red first); the swaps ride existing navigation e2e and `npm run gates`.
- **Effort:** M (17 one-line sites)
- **Risk:** missed per-site `state` payloads; CI-verifiable
- **Contracts:** C1, C4, Aggregation

### P2-3  Three native-LLM probe hooks remain structurally identical

- **Severity:** LOW, confirmed (prior P2-3, open)
- **Site:** `hooks/useNativeLlmSupported.ts` (78 lines), `hooks/useAppleIntelligenceSupported.ts` (76), `hooks/useGeminiNanoSupported.ts` (82)
- **What is wrong:** The bodies differ only in plugin import path, mock-window key, `reason` union, platform predicate, and Gemini's `probeCount`; the effect body is copy-paste.
- **Why it matters:** Maintenance only; a probe-lifecycle fix must land three times.
- **Fix:** `hooks/native-llm/useNativeProbe.ts` factory taking `{ load, mockKey, platformOk }`; the three hooks become typed wrappers keeping names and mock seams. Dynamic import stays inside the factory (Native contract).
- **Verification:** The three hooks' existing unit tests unchanged; `npm run gates`.
- **Effort:** S
- **Risk:** e2e mock-seam semantics; assistant e2e covers
- **Contracts:** C1, Native

### P2-4  Page-title cluster mostly converged; four stragglers

- **Severity:** LOW, confirmed (prior P2-4, mostly fixed by 4c6f2ecd)
- **Site:** `pages/DeveloperNotice.tsx:172` (`text-xl sm:text-2xl font-semibold`), `pages/Montage.tsx:511,527` (no `sm:` step), `pages/Timeline.tsx:344` (error-wall title does not match its own `:402`), `pages/Dashboard.tsx:48` (no `tracking-tight`)
- **What is wrong:** Nine pages share one class string by hand; four still differ.
- **Why it matters:** Cosmetic; DeveloperNotice is visibly larger than every sibling page.
- **Fix:** Align the four strings to the converged recipe (`text-base sm:text-lg font-bold tracking-tight`). A `PageHeader` component only if the cluster grows a subtitle or action API.
- **Verification:** cosmetic, existing gates.
- **Effort:** S (4 sites)
- **Risk:** none
- **Contracts:** C1

### P2-5  Duration formatting re-implemented at three sites, one renders a different form

- **Severity:** LOW, confirmed (prior P2-5, open)
- **Site:** `components/events/EventProgressBar.tsx:48-50`, `components/events/CompactEventRow.tsx:59`, `components/timeline/EventPreviewPopover.tsx:55` (moved since the prior review, code unchanged)
- **What is wrong:** `formatElapsedShort` exists with hours support; the three sites hand-roll `m:ss`. `CompactEventRow.tsx:59` has no hours field (a 90-minute event renders "90:00"); the popover renders "4m 7s" for the datum the rows render as "4:07" (both verified by reading).
- **Why it matters:** The same event shows two duration spellings on one screen (timeline row versus hover popover).
- **Fix:** Call `formatElapsedShort(secs * 1000)` at the three sites.
- **Verification:** Existing `lib/__tests__` for `formatElapsedShort`; component swaps ride existing gates. If the popover's "Xm Ys" form is wanted, that is a new helper branch with a red-first assertion.
- **Effort:** S (3 sites)
- **Risk:** popover wording change; intended
- **Contracts:** C1, Date and time

### P2-6  Destructive class string pasted at six sites; Logs confirm still default-styled

- **Severity:** LOW, confirmed (prior P2-6, open)
- **Site:** `components/events/DeleteBatchBar.tsx:42`, `pages/Profiles.tsx:706,738,758`, `pages/NotificationHistory.tsx:233`, `pages/DeveloperNotice.tsx:310` (pasted `bg-destructive text-destructive-foreground hover:bg-destructive/90`); `pages/Logs.tsx:548` `AlertDialogAction` with no destructive styling (verified)
- **What is wrong:** Six pasted copies instead of `buttonVariants({ variant: 'destructive' })`; the clear-logs confirm is the one destructive action rendered as a primary button.
- **Why it matters:** Clear-logs reads as a safe action; a theme change to the destructive token misses the pasted copies.
- **Fix:** Six one-line `buttonVariants` swaps, `variant="destructive"` on DeleteBatchBar and Logs. Pattern: `components/ui/button.tsx` `buttonVariants`.
- **Verification:** delete and clear e2e testids unchanged; `npm run gates`.
- **Effort:** S
- **Risk:** Logs action becomes red; intended
- **Contracts:** C1, C4, Controls

### P2-7  List-page skeleton triplicated; PageContainer bypassed on eleven wrappers

- **Severity:** LOW, confirmed (prior P2-7, open, bypass count widened)
- **Site:** Skeletons at `pages/Monitors.tsx:227-236`, `pages/Montage.tsx:490-499`, `pages/Events.tsx:494-509`. Padding bypass (`p-8` where `PageContainer` gives `p-3 sm:p-4 md:p-6`): `Monitors.tsx:227`, `Montage.tsx:490,509,525`, `Events.tsx:494`, `Timeline.tsx:343`, `MonitorDetail.tsx:295`, `EventDetail.tsx:445`, `NotificationSettings.tsx:335,348`
- **What is wrong:** `query-state.tsx` exports `DetailPageSkeleton` but no list variant, so three pages hand-roll one; the loading, error, and empty wrappers hardcode `p-8` while the loaded state renders inside `PageContainer`, so on a phone the content shifts 20px inward when loading finishes.
- **Why it matters:** Visible re-pad on every cold load of four pages; NotificationSettings has different gutters from every other settings page.
- **Fix:** `ListPageSkeleton({ variant: 'rows' | 'grid' })` beside `DetailPageSkeleton`, wrapped in `PageContainer`; wrap the error and empty branches in `PageContainer` too.
- **Verification:** cosmetic; existing gates.
- **Effort:** M (3 skeleton sites plus 11 wrapper sites, each one line)
- **Risk:** Events' skeleton fills height (`h-full`); needs the variant
- **Contracts:** C1, Query UI states

### P2-8  NotificationSettings hand-rolls an empty state

- **Severity:** LOW, confirmed (new)
- **Site:** `pages/NotificationSettings.tsx:335-344`
- **What is wrong:** Icon, `h2`, and description centered in a `min-h-[400px]` box, exactly `EmptyState`'s shape (`components/ui/empty-state.tsx:13-17`); its `h2` uses `text-xl font-semibold`, matching no other empty state.
- **Why it matters:** Only page-level empty state not on the shared component; styling drift already present.
- **Fix:** `<EmptyState icon={AlertCircle} title=... description=... />` inside `PageContainer`, keeping `data-testid="notification-settings-empty"`. Pattern: `pages/Montage.tsx:531`.
- **Verification:** cosmetic; existing gates and any e2e keyed on the testid.
- **Effort:** S (1 site)
- **Risk:** none
- **Contracts:** C1, Query UI states

Path to 10/10.

Worth it: P2-1 and P2-2 (shipped user-visible drift, and the deep-link class with the worst defect history); P2-5 (two duration spellings on one screen); P2-6 minimal form (Logs confirm styling is a real UX defect); P2-7 wrapper half (visible re-pad on every cold load); P2-8 (one-site swap, rides with P2-7).

Not worth it: a generic page framework or `PageHeader` component (the nine-site convergence happened by hand and holds); merging the scoped fan-out hooks (the per-hook `refetchProfile` bodies differ in the query key and that is the point); a shared `ConfirmDialog` for six stable AlertDialogs; extracting the one-line `stillWaiting` predicate; the probe factory (P2-3) unless a fourth backend arrives.

## Pillar 3: Contract and rule adherence (7.1/10)

Paths in this section are relative to `app/src/`. Every count is a fresh grep over `app/src` excluding tests, confirmed by reading the cited file.

Strengths verified (measured):

- HTTP: 1 `fetch(` in production code, inside the sanctioned adapter (`lib/http/adapter-web.ts:108`); no `axios` import anywhere.
- Logging: 5 `console.*` calls in production, all inside `lib/logger.ts` or its file sink; zero in app code.
- Server queries: 0 inline `queryKey: [` arrays (one doc-comment hit); 0 literal `refetchInterval` sites.
- Stores: 0 `getState().x =` mutations, 0 whole-store subscriptions.
- Sessions: fully mechanized (`tests/agents-contracts.test.ts:241-299`) and green.
- Aggregation: all 14 `ALL_PROFILES_ID` references sit in the rehydrate migration, legacy arms, or the sessions registry; all 24 `getCurrentSession()` consumers are gated or parented; `useProfileScope().settings` has 0 hits.
- Native: every static `@capacitor/*` import is `@capacitor/core` or `import type`; the Android `ACCESS_LOCAL_NETWORK` clause is now mechanized (`agents-contracts.test.ts:311-334`), a gate the prior review did not have.
- Date and time: 0 literal pattern strings passed to `format(`.
- Localization: 0 literal JSX sentence text in the sample greps; placeholder parity gate with a 1000-key floor.
- Instruction budget: 2067 of 2100 words, every raise with a reason comment.

### P3-1  Ten Gate lines name a file that never asserts their Never clause

- **Severity:** MED, confirmed (prior P3-1, open)
- **Site:** `AGENTS.project.md` Gate lines for Settings, Polling, HTTP, Logging, Server queries, Stores, Query UI states, Date and time, Localization (hardcoded-string half), Constants; `tests/agents-contracts.test.ts` (whole file)
- **What is wrong:** The gate file mechanizes contract format, symbol existence, portability, word budget, M5 hygiene, doc style, Sessions, the Android permission, rule IDs, and locale placeholders. No assertion greps for `console.`, `fetch(`/`axios`, `queryKey: [`, `refetchInterval: <number>`, date-fns literals, raw `getProfileSettings` bypass, or ad-hoc error markup (verified: grep of the test file for those tokens is empty).
- **Why it matters:** M2: a green `agents-contracts` run is read as proof the Never clauses held, when it proves only that the prose parses. P3-2 is the live case.
- **Fix:** See P13-1, which absorbs this finding and names the surviving gate.
- **Verification:** Each new assertion proven red against a scratch violation before landing (P2), then green.
- **Effort:** M (1 test file, ~6 blocks; 10 Gate lines)
- **Risk:** doc-comment false positives (`useBandwidthSettings.ts:22`, `providers/openai.ts:19`); strip comments first. CI-verifiable
- **Contracts:** M1, M2, M4, and the ten contracts named

### P3-2  `services/download.ts` statically imports a store; the named gate cannot see it

- **Severity:** MED, confirmed (prior P3-2 and P4-1, open)
- **Site:** `services/download.ts:23` `import { useBackgroundTasks } from '../stores/backgroundTasks';`, used at `:401`, `:429`, `:431`
- **What is wrong:** The Service boundary Never clause is "a service statically importing a store". Every other service uses `await import` or gate injection; this is the sole static import. `tests/no-circular-deps.test.ts` walks cycles only, so a static import that closes no cycle passes.
- **Why it matters:** The contract's stated purpose is direction and the only mechanized check measures something else; the violation has shipped green through two review cycles.
- **Fix:** Gate injection as `setPushServiceStoreGates` in `services/pushNotifications.ts` (wired from `stores/notifications.ts:29`), or the dynamic form at `services/profile-bootstrap.ts:188`. Add `it('no service statically imports a store')` beside `agents-contracts.test.ts:293`, walking `src/services/*.ts` with the regex `no-circular-deps.test.ts:20` uses; extend it to transitive paths through `lib/` to also catch P4-2.
- **Verification:** new direction assertion red on current code, green after; `services/__tests__` download suite stays green.
- **Effort:** S (1 import, 3 call sites, 1 test block)
- **Risk:** the dynamic-import variant makes `downloadFileNative` callers async; injection avoids that
- **Contracts:** Service boundary, M1, M2

### P3-3  Two components bypass `mergeProfileSettings` with duplicated defaults

- **Severity:** MED, confirmed (prior P3-3, open)
- **Site:** `components/theme-provider.tsx:48-59` (`profileTheme` raw select with `localTheme` fallback from `defaultTheme = "system"`); `components/monitors/LiveMonitorPlayer.tsx:186-192` (`rawSettings` raw bucket, `rawSettings?.streamingMethod ?? 'auto'`, raw `monitorStreamingOverrides` read)
- **What is wrong:** The Settings Never clause forbids coercions outside the merge. Both sites select the raw bucket and re-implement the default inline. The sanctioned reactive template is `hooks/useCurrentProfile.ts:79-83,126` (raw select, then `mergeProfileSettings` in `useMemo`).
- **Why it matters:** The next default added to `mergeProfileSettings` reaches every reader except these two, and the player is the hottest settings consumer in the app.
- **Fix:** Apply the `useCurrentProfile.ts:79-83` template at both sites and delete the inline defaults. Keep the merge outside the selector; `theme-provider.tsx:46-47` explains why calling `getProfileSettings` inside the selector loops.
- **Verification:** unit test asserting a merge-level default change reaches `LiveMonitorPlayer`'s streaming choice and the theme provider, proven red first.
- **Effort:** S (2 files, 3 read sites)
- **Risk:** none if the merge stays in `useMemo`; CI-verifiable
- **Contracts:** Settings, Stores

### P3-4  `MontageMonitor` mints an object inside a `useShallow` selector

- **Severity:** LOW, confirmed (prior P3-4, open; same site as P6-3)
- **Site:** `components/monitors/MontageMonitor.tsx:170-172`
- **What is wrong:** Stores Never clause: minting objects inside a selector. `getProfileSettings` returns a fresh merged object every call; `useShallow` compares one level down so it does not loop today.
- **Why it matters:** Every settings write re-runs the merge for every tile; a nested field added to `ProfileSettings` turns the shallow compare into a per-write re-render of the whole grid.
- **Fix:** Same template as P3-3. See P6-3 for the test.
- **Verification:** real-store regression test per the testing playbook, red first.
- **Effort:** S (1 site)
- **Risk:** none
- **Contracts:** Stores, Settings

### P3-5  Auth contract text forbids what the protocol requires

- **Severity:** LOW, confirmed (prior P3-5, open; code correct, contract wrong)
- **Site:** `AGENTS.project.md:35` Auth tokens Never: "tokens in URL query strings". Code: `lib/zm/url-builder.ts`, `api/events.ts`, `services/discovery.ts` append the access token because `img`/`video` cannot send headers; `lib/logger.ts:321` redacts via `sanitizeLogMessage`.
- **What is wrong:** `domain-context.md` does not record the access-token-in-URL design either, so a new agent has only the Never clause and will "fix" the URL builder.
- **Why it matters:** Removing the token from stream URLs breaks every live view and event playback.
- **Fix:** Via M3: narrow the clause to refresh tokens, with access tokens permitted where the protocol requires them; add one line to `domain-context.md` naming the sites.
- **Verification:** contract-format and word-budget tests stay green (33 words of headroom).
- **Effort:** S
- **Risk:** none
- **Contracts:** Auth tokens, M3, M5

### P3-6  C2 stays ungated: 54 production files over 400 lines

- **Severity:** LOW, confirmed (prior P3-6 and P4-4, open and worse)
- **Site:** `lib/zmninja-ng-constants.ts` (1392), `components/assistant/AskPanel.tsx` (942), `api/types.ts` (894), `pages/EventDetail.tsx` (863), `stores/notifications.ts` (838), `stores/profile.ts` (829), and 48 more; `app/.lint-baseline.json` has no `max-lines` entry; `eslint.config.js` has no `max-lines`
- **What is wrong:** Prior count 52; now 54 (orchestrator count, `wc -l` over tracked non-test `.ts`/`.tsx`). No gate (M1) and the number moved the wrong way.
- **Fix:** See P13-7.
- **Verification:** `npm run lint:ratchet` red when a file crosses the baseline count.
- **Effort:** S for the gate; do not mass-split
- **Risk:** none
- **Contracts:** C2, C7, M1

### P3-7  Four gate files cite retired numeric rule IDs; the ID scan skips `src/tests`

- **Severity:** LOW, confirmed (prior P3-7, open)
- **Site:** `tests/no-em-dash.test.ts:2,46,56` ("rule 1"), `tests/no-circular-deps.test.ts:2,88` ("rule 28"), `tests/e2e-steps.test.ts:2` ("rules 6 and 12"), `tests/dependency-classification.test.ts:2` ("rule 37"); the scan at `agents-contracts.test.ts:343` reads only `docs/developer-guide/*.rst`
- **What is wrong:** `AGENTS.md` uses tiered IDs; "rule 28" resolves to nothing, so a failing gate prints a citation the contributor cannot follow.
- **Why it matters:** Same reader trap the ID scan exists to prevent, in the gate messages themselves.
- **Fix:** Update the 7 comment sites and extend the loop at `agents-contracts.test.ts:344` to also walk `app/src/tests/*.ts`. This is distinct from the ~37 source comments citing old rule numbers, which `out-of-scope.md` declines to rewrite; gate messages are user-facing output, not inert comments.
- **Verification:** the extended scan red on the current comments, green after.
- **Effort:** S
- **Risk:** none
- **Contracts:** M4

### P3-8  Five inline timer literals

- **Severity:** LOW, confirmed (prior P3-8, partly moot)
- **Site:** `components/assistant/AskPanel.tsx:150` (`2000`), `:370` (`1000`); `pages/LiveActivity.tsx:255` (`1000`); `components/QRScanner.tsx:166` (`100`); `services/pushNotifications.ts:313` (`200`). The prior list's `AssistantOllamaSection.tsx` site no longer exists.
- **What is wrong:** C4 and the Constants contract; `zmninja-ng-constants.ts` already groups timings.
- **Fix:** Name them beside the existing groups, or add a one-line UI-tick exception to the contract via M3. Pick one.
- **Verification:** review; a `setTimeout\(.*,\s*\d{2,}\)` grep in P13-1 would gate it.
- **Effort:** S
- **Risk:** none
- **Contracts:** Constants, C4

### P3-9  Five duplicated `staleTime` literals beside a named default

- **Severity:** LOW, confirmed (new)
- **Site:** `hooks/useGroups.ts:87`, `hooks/useEventTags.ts:62,141`, `hooks/useScopedEventTags.ts:71,182`, all `5 * 60 * 1000` or `2 * 60 * 1000` with a `// 5 minutes` comment (10 grep hits including comments)
- **What is wrong:** `DEFAULT_QUERY_STALE_TIME_MS` lives at `lib/zmninja-ng-constants.ts:56`; the "rarely changes" tier is repeated inline.
- **Fix:** one `QUERY_STALE_TIME_MS = { rarelyChanges, tagMapping }` beside the default; five one-line edits.
- **Verification:** review; the P13-1 grep `staleTime:\s*\d` catches regressions once added.
- **Effort:** S (5 sites, 1 constant)
- **Risk:** none
- **Contracts:** Constants, C4

### P3-10  `src/contexts` is a one-file folder

- **Severity:** LOW, confirmed (prior P4-5, open)
- **Site:** `contexts/PipContext.tsx` (sole file); `assets/react.svg` is also a lone file, referenced nowhere
- **What is wrong:** C5. No gate exists.
- **Fix:** See P13-7 for the rule decision; if C5 stays, move `PipContext.tsx` beside its consumers (`components/events/`, 2 import edits) and delete `assets/react.svg`.
- **Verification:** `npm run gates` (build).
- **Effort:** S
- **Risk:** import path churn only
- **Contracts:** C5, C2, M1

Path to 10/10.

Worth it: P3-1 via P13-1 (the cheap greps plus honest rewording; it converts every other finding here into a CI failure instead of a review note), P3-2 with its direction assertion, P3-3 and P3-4 onto the `useCurrentProfile` template, P3-5 and P3-7 text corrections, the P3-6 ratchet entry, P3-9's single constant.

Not worth it: splitting the 17 over-700-line files now (ratchet the growth, split opportunistically); mechanizing Aggregation, Query UI states, and the hardcoded-string clause (each needs semantic judgment; M2 says a gate with wrong input is worse than honest review); moving `src/assets`.

## Pillar 4: Architecture and modularity (8.7/10)

Paths in this section are relative to `app/src/`.

Strengths verified:

- Static module graph acyclic and gated: `tests/no-circular-deps.test.ts:20` walks `import`/`export ... from` including type-only imports. `madge --circular` reports 4 cycles, each traced to a deliberate `await import()` break with an explaining comment (`services/profile-bootstrap.ts:262,329,351`; `stores/profile.ts:307,369`).
- Auth-to-sessions direction gated (`agents-contracts.test.ts:293`); injection via `registerSessionsGate` and `createStoreApiClient` (`api/store-gates.ts:11-12`, the only api-to-stores static edge).
- Query-key discipline: `lib/query/query-keys.ts` factory with branded `ProfileId`; zero inline key arrays; 39 non-test consumers; `stores/query-cache.ts` evicts per profile.
- Persistence versioned where shape changed (`stores/settings.ts:770-771`, `stores/dashboard.ts:197-201`, `stores/notifications.ts:724`).
- Auth secrets partitioned: `stores/auth.ts:123` `encryptedAuthStorage`, the only store with a custom `storage:`.
- `dependency-classification.test.ts` keeps runtime imports in `dependencies`.

### P4-1  `services/download.ts` statically imports a store

Same finding as P3-2; counted once under Pillar 3 for the rubric and listed here so the architecture executor finds it. Site `services/download.ts:23`.

### P4-2  Service reaches `stores/profile` statically through a lib helper

- **Severity:** LOW, confirmed (prior P4-2, open)
- **Site:** `services/pushNotifications.ts:24` imports `lib/profile/notification-profile.ts`, whose line 10 is `import { useProfileStore } from '../../stores/profile'`
- **What is wrong:** Transitive static services-to-stores edge; only `stores/profile.ts:307,369` `await import('./notifications')` keeps it from being a static cycle (madge cycle 3).
- **Why it matters:** A direct-import-only direction gate (P3-2) would not see this.
- **Fix:** Pass the profile list into `resolveProfileForNotification` from the store-side caller, or resolve behind `setPushServiceStoreGates`; extend the P3-2 walk to transitive paths through `lib/` by reusing `buildGraph` from `no-circular-deps.test.ts:45`.
- **Verification:** P3-2 test extended to transitive reach, red first.
- **Effort:** S (3 sites)
- **Risk:** low
- **Contracts:** Service boundary, Notifications

### P4-3  Query predicate hardcodes a domain string the factory owns

- **Severity:** LOW, confirmed (new)
- **Site:** `hooks/useBulkDeleteEvents.ts:45` (`queryKey[0] === 'events' || queryKey[0] === 'monitorRecentEvents'`) and `:126` (`q.queryKey[0] === 'monitorRecentEvents'`); factory at `lib/query/query-keys.ts:96-100`
- **What is wrong:** The domain literal lives outside `query-keys.ts`, so a factory rename silently stops the bulk-delete invalidation; `monitorRecentEvents` has no domain-prefix helper, so the hook had no sanctioned way to prefix-match.
- **Why it matters:** After a bulk delete the per-monitor recent-events tiles can keep deleted events if the key drifts; the failure is silent.
- **Fix:** Add `monitorRecentEventsAll: (profileId) => ['monitorRecentEvents', profileId] as const` next to `monitors` (`query-keys.ts:35`) and invalidate by key; same for the `'events'` literal. Optionally extend the inline-key grep to `queryKey[0] === '` literals.
- **Verification:** `useBulkDeleteEvents` unit test asserting the recent-events query is invalidated, red first; `npm run gates`.
- **Effort:** S (2 sites plus 1 factory line)
- **Risk:** none
- **Contracts:** Server queries, C4

### P4-4  C2 file-length ungated

Same as P3-6 and P13-7; not double-counted.

### P4-5  One-file folder and dead template asset

Same as P3-10; not double-counted.

### P4-6  Profile store persists to default localStorage

- **Severity:** MED impact, theoretical (prior P4-6; no field report; not counted in the score)
- **Site:** `stores/profile.ts:149` `persist(` with options at `:691-695`; no `storage:` option. Only `stores/auth.ts:640` sets one.
- **What is wrong:** Root user data (servers, current profile) rides zustand's default `localStorage`, which WebKit documents as evictable under storage pressure; refresh tokens would survive orphaned in the Keychain.
- **Why it matters:** Losing every configured server is I2-class data loss with no recovery path.
- **Fix:** A `PersistStorage` adapter over Capacitor Preferences for the profile store on native, template `encryptedAuthStorage` at `stores/auth.ts:123`, with a one-time rehydrate migration from the localStorage key.
- **Verification:** Unit test on adapter plus migration (red first via a mocked Preferences read); durability itself is device-only, manual.
- **Effort:** M
- **Risk:** async rehydration where localStorage was sync; the hang guard at `profile.ts:712-715` is the thing to test
- **Contracts:** I2, Settings, Native

Path to 10/10.

Worth it: P3-2 with the direction assertion (and the transitive walk that also closes P4-2); P4-3 (three lines); the P13-7 ratchet counter; P3-10; P4-6 for the profile store only.

Not worth it: splitting the 54 oversized files for literal C2 compliance; converting the remaining persisted stores (monitors, dashboard, favorites, seen) to Preferences (eviction there costs a re-fetch, not data); replacing `await import()` cycle breaks with a DI container or event bus; chasing madge parity (its 4 reports are the sanctioned pattern working); forbidding `lib/` to `stores/` static imports as a new contract (no rule names it and the acyclic gate bounds the harm).

## Pillar 5: Test quality and automation trust (4.2/10)

Strengths verified:

- The step-definition gate is real and AST-based: `app/src/tests/e2e-steps.test.ts:54-85` parses every step file with the TypeScript compiler, fails assertion-less `Then` steps (`:96-104`) and orphan definitions (`:106-111`).
- `services/` (11 files) and `lib/security/` (5 files) each have a sibling `__tests__/<name>.test.ts`; no gaps.
- API-derived capability skips are the established pattern (`app/tests/helpers/zm-api.ts:63,84,104,150`; 26 call sites). ec43a4dd replaced a URL-derived guard with `serverHasTwoMonitors()` and dropped an e2e scenario that passed with the fix disabled; proven-red discipline is applied, not just written.
- Proven-red is a CI job (`.github/workflows/ci.yml:184-215`) and its own tests run there.
- The quality ratchet counts real anti-patterns (`app/scripts/quality-ratchet.mjs:48-49`, baseline 121 internal mocks, 302 existence assertions, 115 avoided terms).
- Settled-state waits where they matter (`settings.steps.ts:155-162,172-188`), with the render-race reasoning inline.

One plausible bug the suite would miss: the Add Server form renames its name field testid, no profile is ever created, and every e2e run stays green (P5-1).

### P5-1  Profile-creation chain passes without creating a profile

- **Severity:** HIGH, confirmed (prior P5-1, open, no commit touched these lines)
- **Site:** `app/tests/steps/profiles.steps.ts:103-106` (`I fill in new profile connection details`, name fill guarded by `isVisible().catch(() => false)`), `:146-149` (`I save the new profile`, disabled Add "that's OK for test"), `:164-172` (`I should see the new profile in the list`, `count() >= 1` fallback when `newProfileName` is empty)
- **What is wrong:** A renamed `setup-profile-name` testid leaves `newProfileName` unset, the Then takes the `>= 1` branch, and the pre-existing default profile satisfies it. The file's own comment at `:161-163` names this exact failure.
- **Why it matters:** Add-server is the onboarding path; a form regression ships green.
- **Fix:** Hard-assert every form field (`await expect(nameInput).toBeVisible()` then `fill`), assert `saveBtn` enabled, delete the count fallback. Pattern: `monitor-zoom-pan.steps.ts` post-ec43a4dd (unconditional assertion once capability is API-confirmed).
- **Verification:** Manual e2e proven red per `agents/project/testing.md` stash procedure (`git stash push app/src/pages/ProfileForm.tsx` with a testid rename); the P5-5 gate extension then catches it structurally.
- **Effort:** S (3 sites, one file)
- **Risk:** May surface a real red the fallback hides; #342 degraded-server baseline applies
- **Contracts:** C6, P2

### P5-2  Group-filter capability flag reassigned from UI visibility

- **Severity:** HIGH, confirmed (prior P5-2, open)
- **Site:** `app/tests/steps/group-filter.steps.ts:36` (`groupFilterAvailable = await groupFilter.isVisible(...)`, overwriting the API-derived value set at `:26`); `:54` sets it false again when no option renders; `:45` carries `waitForTimeout(300)`
- **What is wrong:** The file header at `:14-16` bans exactly this. A filter that stops rendering skips `:38-57` and every later `if (groupFilterAvailable)` step.
- **Why it matters:** "Group filter disappeared" is a plausible regression of the monitors page and passes CI.
- **Fix:** Delete `:36`; when `groupFilterAvailable`, `await expect(groupFilter).toBeVisible()` then `click()`; replace `:45` with an auto-retrying `expect` on the first `group-filter-*` option. Pattern: same file `:20-24`.
- **Verification:** P5-5 gate rule "no capability flag assigned from `isVisible` in a step body" proven red against this line.
- **Effort:** S (1 site)
- **Risk:** none beyond exposing a real red
- **Contracts:** C6, M1

### P5-3  Bandwidth-toggle scenario cannot detect a broken toggle

- **Severity:** MED, confirmed (prior P5-3, open)
- **Site:** `app/tests/steps/settings.steps.ts:194-201` (`I toggle bandwidth mode`, no-ops when no selector matches), `:203-207` (`the bandwidth mode label should update`, asserts `text=/low|normal/i` present)
- **What is wrong:** The Then asserts static text that exists before and after any click; the When's three-way `.or()` chain has no hard assertion. A toggle that renders but does nothing, or does not render, both pass.
- **Why it matters:** Bandwidth mode drives every polling interval (Polling contract).
- **Fix:** Read the label before the click, hard-assert the toggle, assert the label changed. Pattern: `:172-188` (`expect.poll` on `isChecked()` against a captured prior state).
- **Verification:** Manual e2e red with the toggle handler stubbed; P5-5 gate.
- **Effort:** S (2 sites; confirm a `data-testid` on the toggle)
- **Risk:** low
- **Contracts:** C6, Polling

### P5-4  43 fixed sleeps, no gate

- **Severity:** MED, confirmed (prior P5-4, open; count identical)
- **Site:** `grep -c waitForTimeout app/tests/steps/*.ts` sums to 43 (events 12, settings 8, common 6, kiosk 5, group-filter 4, dashboard 2, profiles 2, timeline 2, all-profiles 1, hidden-monitors 1)
- **What is wrong:** `agents/project/testing.md` says "Do not use fixed `waitForTimeout`"; nothing enforces it and the count has not moved through 13 commits touching `app/tests/steps` since 2026-08-06.
- **Why it matters:** Each sleep is a latent flake and 0.3 to 0.5 s per run; a real timing regression becomes an intermittent red nobody trusts.
- **Fix:** Third `it` in `e2e-steps.test.ts` counting `waitForTimeout` per file against a checked-in allowlist that only shrinks. Pattern: `app/scripts/lint-ratchet.mjs` plus `app/.lint-baseline.json` (C7).
- **Verification:** Gate proven red before the allowlist is seeded (P2).
- **Effort:** M (gate S; 43 replacement sites are a long tail, burn down per touch)
- **Risk:** Naive replacements flake where a sleep hid a real transition; replace each with the awaited condition
- **Contracts:** M1, C7, P2

### P5-5  Then-assertion gate checks presence, not reachability

- **Severity:** MED, confirmed (prior P5-5, open)
- **Site:** `app/src/tests/e2e-steps.test.ts:99` (`asserts` regex `/\bexpect\s*[.(]/` over `s.body` text)
- **What is wrong:** The regex passes a Then that opens with a guarded `return` (`settings.steps.ts:174-176`, `profiles.steps.ts:68`, `assistant.steps.ts:92`, `zone-overlay.steps.ts:57-61`) and would pass `expect(` inside a comment. Every conditional-pass finding in this pillar sails through the gate that exists to catch that class.
- **Why it matters:** M2: the gate's number (zero unassertive Then steps) does not describe what it claims.
- **Fix:** Use the `ts.Node` already in hand instead of `node.getText()`: walk the function body, flag a `ReturnStatement` inside an `IfStatement` before the first `expect`/`assert*` call unless the condition references an allowlisted `zm-api.ts` helper or a `let` set by one; flag any `.isVisible(` `.catch(` inside an `if` condition in a Then. Pattern: the existing AST visitor `:63-80`.
- **Verification:** Proven red against current `settings.steps.ts`, `profiles.steps.ts`, `group-filter.steps.ts`; green after P5-1, P5-2, P5-3, P5-6, P5-8 land. Sequencing: land the gate with those files allowlisted, then fix them and shrink the allowlist; landing the gate alone turns green scenarios red.
- **Effort:** M (~40 lines plus the step fixes it forces)
- **Risk:** False positives absorbed by the helper allowlist
- **Contracts:** M1, M2, C6

### P5-6  Notification-toggle Then skips on visibility of the UI under test

- **Severity:** LOW, confirmed (prior P5-6, open)
- **Site:** `app/tests/steps/settings.steps.ts:164-170` (When, guarded fill), `:174-176` (early return)
- **What is wrong:** The assertion at `:186-188` is good once reached; the guard makes it unreachable when the switch disappears.
- **Fix:** `await expect(toggle).toBeVisible()` in both steps; the `-empty` variant at `:161` is the legitimate no-profile branch, so gate on which of `container`/`empty` rendered, not on the switch.
- **Verification:** P5-5 gate.
- **Effort:** S (2 sites)
- **Risk:** low
- **Contracts:** C6

### P5-7  Event-detail Then passes if any one of three controls is visible

- **Severity:** LOW, confirmed (prior P5-7, open)
- **Site:** `app/tests/steps/events.steps.ts:765-780` (`expect(hasVideo || hasFavorite || hasDownload)`)
- **What is wrong:** A broken player is masked by the favorite button.
- **Fix:** `await expect(videoPlayer).toBeVisible()` after the API-derived `serverHasEvents()` guard at `:762` (which is correct); leave download conditional.
- **Effort:** S (1 site)
- **Risk:** low
- **Contracts:** C6

### P5-8  Assistant hover pair gates on rendered thumbnail count

- **Severity:** LOW, confirmed (prior P5-8, open)
- **Site:** `app/tests/steps/assistant.steps.ts:87` (`if ((await thumb.count()) === 0) return;`), `:92`
- **What is wrong:** Cards rendering without thumbnails no-op both steps forever; `getEventCount()` is one import away.
- **Fix:** Gate on `getEventCount() > 0`, then `await expect(thumb).toBeVisible()`.
- **Effort:** S (2 sites)
- **Risk:** low
- **Contracts:** C6

### P5-9  Disjunctive presence Then steps that cannot fail on a rendered app shell

- **Severity:** MED, confirmed (new; the prior review audited only the three largest step files)
- **Site:** `app/tests/steps/settings.steps.ts:267-274` (`I should see log control elements`: `hasAnyButton = main button count > 0` ORed in, verified), `:237-245` (`hasHeading = any heading visible`), `:19-22`, `:248-261` (`main h1,h2,table count > 0` plus `waitForTimeout(500)` at `:250`); `app/tests/steps/timeline.steps.ts:252-262` (`the timeline should be scrollable`: ORs in `timeline-container` visible, the page root), `:189-196` (any `[role=checkbox]` on the page), `:243-250`; `app/tests/steps/monitor-detail.steps.ts:17-22` (`I should see the monitor player`: settings panel visible satisfies "player", verified)
- **What is wrong:** Each step ORs a specific testid with a generic fallback that is true whenever the app shell renders. The `expect` is present, so the gate at `e2e-steps.test.ts:99` is satisfied, but the step distinguishes nothing from a page that rendered chrome and no content. `settings.steps.ts:210-213` documents the same defect being fixed once ("passed whenever `<main>` had more than three descendants"); these are the remaining instances. Two-state `content || empty` disjunctions are legitimate; the defect is the third generic term.
- **Why it matters:** Logs losing its level filter, the timeline losing its content area, or MonitorDetail losing its player all stay green.
- **Fix:** Drop the generic term; keep exactly the app-owned states (`content || empty`) and assert the specific control. For `monitor-detail.steps.ts:17-22` assert `video-player` (the sibling step `:25-28` already does). Pattern: `settings.steps.ts:210-234` and `timeline.steps.ts:119-123`.
- **Verification:** Per-site manual proven red (hide the control via stash); per-site fixes are cheaper than a generic rule here.
- **Effort:** M (8 sites, 3 files)
- **Risk:** Some sites will go red against the demo server's real state; #342 baseline applies
- **Contracts:** C6

### P5-10  Readiness poll that asserts `>= 0`

- **Severity:** LOW, confirmed (new)
- **Site:** `app/tests/steps/profiles.steps.ts:74-76` (`expect.poll(count).toBeGreaterThanOrEqual(0)`)
- **What is wrong:** Passes on the first sample unconditionally, so it is not a wait.
- **Fix:** Delete the poll; assert the add button visible, which the next line needs anyway.
- **Effort:** S (1 site)
- **Risk:** none
- **Contracts:** C6

Path to 10/10.

Worth it: P5-5 gate extension first; it is the one change that closes the class and mechanically forces P5-1, P5-2, P5-3, P5-6, P5-8, and every other conditional-pass fix without it regresses on the next step file. P5-2 (one line) and P5-1 (one file) immediately: both are core journeys called HIGH three weeks ago with no movement. P5-4 ratchet gate; seeding the allowlist costs an hour and stops the count growing. P5-9 per-site cleanups when each file is next touched.

Not worth it: rewriting all 43 sleeps in one wave (per-site condition analysis is the real cost); full e2e determinism against the shared demo server (API-derived skips are the sanctioned design and #342 tracks the degraded-server baseline); unit tests duplicating e2e journey assertions (`testing.md` forbids double-covering across tiers); a generic "no `||` in Then" gate (`content || empty` disjunctions are legitimate and numerous); chasing `lib/` subfolders without `__tests__/` dirs (`lib/` tests sit in `app/src/lib/__tests__/` by convention).

## Pillar 6: Runtime performance (7.4/10)

Paths in this section are relative to `app/src/`.

Strengths verified:

- Canvas bitmap reallocation gated by `lastCanvasDimsRef` (`components/timeline/TimelineCanvas.tsx:257-264`), rationale in-file.
- Montage viewport gating: one `IntersectionObserver` for the grid, per-tile ref callbacks cached in a Map (`hooks/useViewportGating.ts:70-74,111,154`).
- Montage resolvers and pin callbacks are stable (`pages/Montage.tsx:299-318`, `components/montage/hooks/useMontageGrid.ts:466-475`).
- Per-tile alarm selector returns a shared `NO_MONITOR_EVENTS` sentinel under `useShallow` (`components/monitors/MontageMonitor.tsx:47,193-199`).
- Event list: `EventItem` is `memo`, `monitorMap` built once per `monitors` change, parent passes memoized props so the row memo holds.
- Zero whole-store subscriptions in app code; 36 `useShallow` sites; `useAuthSlice` returns a shared `EMPTY_SLICE` sentinel.
- Stream teardown sends CMD_QUIT on every path the domain playbook names; no new missed path found.

### P6-1  Montage tile memo barrier voided by an inline `onPinToggle` closure

- **Severity:** MED, confirmed (prior P6-1, open)
- **Site:** `components/montage/MontageGridSections.tsx:228` `onPinToggle={() => onPinToggle(tileId)}` inside `renderTile`; consumer `components/monitors/MontageMonitor.tsx:477` `memo(MontageMonitorComponent)`
- **What is wrong:** Every other prop to `MontageMonitor` is reference-stable, but this one is a fresh function per parent render, so `memo` never bails out. Every Montage render (status poll, gating change, TV focus move, pinch frame, notification write reaching the page) reconciles every tile.
- **Why it matters:** 16 to 30 tile walls on Fire Stick and low-end Android pay a full-tree reconcile on every poll and every pinch frame. Streams survive (the player's effects are keyed); the cost is jank and CPU.
- **Fix:** Give `MontageMonitor` a `tileId` prop and pass `onPinToggle` through as the stable `(tileId) => void` it already is (`useMontageGrid.ts:466`); the tile calls `onPinToggle(tileId)` at `MontageMonitor.tsx:463`. Pattern: `hooks/useViewportGating.ts:154`.
- **Verification:** Unit test in `components/montage/__tests__/` rendering `MontageGridSections` with a spy-wrapped `MontageMonitor`, asserting the spy call count does not grow when the parent re-renders with identical props; proven red pre-fix. Smoothness itself is device-only.
- **Effort:** S (2 files)
- **Risk:** low; pin button behavior unchanged
- **Contracts:** Stores, P2

### P6-2  Pinch frames re-render the whole Montage page

- **Severity:** MED, confirmed (prior P6-2, open)
- **Site:** `hooks/usePinchZoom.ts:43` `setScale(newScale)` per `usePinch` frame; sole consumer `pages/Montage.tsx:422,694-696` uses `scale` only in an inline `style.transform`
- **What is wrong:** React state per gesture frame re-renders `Montage` (745 lines, ~25 hooks) and, through P6-1, every tile, for a value that only feeds one CSS transform.
- **Why it matters:** Pinch is touch-only, so this lands on phones and tablets, the platforms least able to reconcile 16 tiles at 60 Hz.
- **Fix:** Hold a `ref` to the wrapper, write `el.style.transform` imperatively per frame, commit `setScale` only on `last` and in `resetScale`. Pattern for imperative per-frame writes: `components/monitors/LiveMonitorPlayer.tsx:592`.
- **Verification:** Unit test driving the gesture handler with `first`, intermediate, and `last` frames, asserting a probe component's render count increments only on `first`/`last`; red pre-fix. Rubberband and reset are device-only.
- **Effort:** S/M (2 files)
- **Risk:** reset button and rubberband snap-back must re-sync the ref transform with committed state; cover `resetScale` in the same test
- **Contracts:** P2

### P6-3  `MontageMonitor` selects a freshly merged settings object per tile

- **Severity:** MED, confirmed (prior P6-3, open; same site as P3-4)
- **Site:** `components/monitors/MontageMonitor.tsx:170-172`; `stores/settings.ts:587-591` documents routing a `hoverPreview` fill into a persist migration specifically so this selector does not loop
- **What is wrong:** Minting inside a selector; `useShallow` hides it only while every merged field is a primitive or stable reference. The tile reads two booleans (`:443`).
- **Why it matters:** Ongoing: every settings write runs a full merge in every mounted tile. Latent: the next nested-object default in `mergeProfileSettings` turns every montage tile into a maximum-update-depth crash; the repo already paid this once.
- **Fix:** The `useProfileById(currentProfile?.id)` pattern (`hooks/useCurrentProfile.ts:111-126`), which `EventListView.tsx:88` already uses per row.
- **Verification:** Real-store regression test per `agents/project/testing.md`: render `MontageMonitor` against the real settings store with a nested object seeded, assert render count stays bounded; red pre-fix.
- **Effort:** S (1 app file plus 1 test)
- **Risk:** low
- **Contracts:** Stores, Settings, P2

### P6-4  Timeline theme colours resolved with `getComputedStyle` on every paint

- **Severity:** LOW, confirmed (prior P6-4, open)
- **Site:** `components/timeline/timeline-renderer.ts:662` `getThemeColors(canvas)` inside `renderTimeline`; `getThemeColors` at `:86-87` reads ~12 custom properties; callers `TimelineCanvas.tsx:278` (every render) and the rAF pulse loop (`:315-316`, ~60 fps for 5 s per live event)
- **What is wrong:** `getComputedStyle` forces style resolution per frame inside a rAF loop and per pan frame.
- **Why it matters:** pan and zoom smoothness on the timeline and CPU during the live pulse, measurable on WebKitGTK and low-end Android.
- **Fix:** Resolve once per mount and on theme change in `TimelineCanvas`, pass `colors` into `renderTimeline`. Pattern: `TimelineCanvas.tsx:167` `monitorIds` memo passed down.
- **Verification:** Unit test spying `getComputedStyle` and asserting one call across N `renderTimeline` invocations (red pre-fix: N calls); assert a re-resolve when the theme prop changes.
- **Effort:** S (2 files)
- **Risk:** theme toggle while the timeline is open; the test covers it
- **Contracts:** P2

### P6-5  `MontageGridSections` rebuilds two lookup Maps per render

- **Severity:** LOW, confirmed (prior P6-5, open)
- **Site:** `components/montage/MontageGridSections.tsx:166-167`
- **What is wrong:** O(tiles) allocations per render on the same hot path as P6-1.
- **Fix:** `useMemo` keyed `[layout]` and `[cappedMonitors]`; fold into the P6-1 commit.
- **Verification:** covered by the P6-1 render-count test.
- **Effort:** S (2 lines)
- **Risk:** none
- **Contracts:** P5 (one logical change with P6-1)

### P6-6  Scrubber re-renders one DOM node per event on every pan and zoom frame

- **Severity:** MED, confirmed (new)
- **Site:** `components/timeline/TimelineScrubber.tsx:431-445` (`events.map` renders one absolutely positioned div per event with percent `left`/`width` from `viewStartMs`/`viewEndMs`); `TimelineScrubber` is `memo` (`:460`) but receives `viewStartMs={viewport.startMs}` `viewEndMs={viewport.endMs}` from `TimelineCanvas.tsx:344-345`, which change on every pan or zoom frame and every `animateToRange` tick; `:194` rebuilds `monitorNameMap` per render
- **What is wrong:** The canvas draws events in one pass and per-frame viewport state was accepted so frames stay direct; the scrubber turns each frame into a React reconcile of `events.length` DOM nodes with inline style writes plus a Map allocation.
- **Why it matters:** Timeline pan jank scales with event count on the touch platforms where pan is the primary interaction; it is the largest remaining per-frame cost after P6-4.
- **Fix:** Cheapest: keep DOM but compute a pre-sorted `startMs` array once per `events` change and render only the visible slice via binary search (`timeline-hit-test.ts` already does viewport-filtered iteration); `monitorNameMap` into `useMemo([monitors])`. Alternative: draw density markers on a small canvas using `timeline-renderer.ts:405-425` `drawEvents`. Keep `memo` and the per-frame props; the goal is cheaper frames, not throttling.
- **Verification:** Unit test rendering `TimelineScrubber` with 1000 events, 990 outside the viewport, asserting `scrubber-density-*` testids rendered equals the visible count; red pre-fix. `app/tests/steps/timeline.steps.ts:146` reads `[data-testid^="scrubber-density-"]`, so the DOM route keeps that e2e green and the canvas route must update it.
- **Effort:** M (1 to 2 files plus tests; e2e selector check)
- **Risk:** events spanning the viewport edges must be handled exactly as `:434-436` do now
- **Contracts:** P2, C6

### P6-7  `TimelineCanvas` paint effect re-scans every event twice per render for pulse state

- **Severity:** LOW, confirmed (new)
- **Site:** `components/timeline/TimelineCanvas.tsx:244-332` (effect with no dependency array; two O(events) scans per render, one more per pulse frame)
- **What is wrong:** Same file as P6-4 and P6-6; the fix is trivial.
- **Fix:** Compute `newestArrivedAt = max(e.arrivedAt)` once in a `useMemo([events])` and compare per frame. Pattern: `hooks/useTimelineData.ts:230-250`.
- **Verification:** pure derivation move; rely on existing gates (P2 exception for no behavior change).
- **Effort:** S (1 file)
- **Risk:** none
- **Contracts:** none beyond P5

Path to 10/10.

Worth it: P6-1 plus P6-5 in one commit (restores the memo barrier every other montage optimization assumes; highest jank per line); P6-2 (pinch becomes free); P6-3 with its real-store test (removes a latent crash class and a documented workaround); P6-6 after P6-4 so the paint path is already cheap; P6-4.

Not worth it: virtualizing `EventListView` or Logs (failed twice, domain playbook); throttling viewport pan and zoom state (per-frame state is what makes panning feel direct; make frames cheaper instead); memoizing `MontageGridSections` itself before P6-1 (the closure busts any wrapper); per-tile `IntersectionObserver`s (the ref-swallowing trap, c8d0d833); a keyed index in the notifications store for the per-tile `monitorEvents` filter (crosses the Notifications contract for a cost that is not user-visible); offscreen-canvas or WebGL timeline (no evidence the 2D path is the bottleneck once P6-4, P6-6, P6-7 land).

## Pillar 7: Native platform integration (4.7/10)

Every finding here needs a device pass to verify a fix. Android compiles in CI (`.github/workflows/build-all.yml:53` `./gradlew assembleDebug`); iOS does not (the macOS job builds Electron only). The prior review's preamble that no CI compiles native code was half right.

Strengths verified:

- Lifetime hygiene on every native resource: `SSLTrustURLProtocol.invalidateSession` (`app/ios/App/App/SSLTrustPlugin.swift:292-298`) invalidates once behind `NSLock`; `PipActivity.onDestroy` releases `MediaSession` then `ExoPlayer`; `TvCursorLayout.onDetachedFromWindow` removes its runnable; `LlamaPlugin.clearDownload` runs on both paths.
- Main-thread discipline at every UIKit and WebView touch (`SafeAreaPlugin.swift:51-63`, `SSLTrustPlugin.swift:95`, `SSLTrustPlugin.java:326,370`, `WindowThemePlugin.java:49`, `TvDetectorPlugin.java:30`); inference stays off the bridge queue.
- Cross-platform ordering fixes are mirrored (`ownsScreen` gate-before-flag, busy slots and `RESPONSE_RESERVE`, `X509CertInfo` expiry format matching Java).
- Permission surface minimal and every absence explained in place (`AndroidManifest.xml:76-92`; `Info.plist` carries only FaceID, camera, local network, photo-add strings); analytics disabled on both.
- Native logging discipline in the app targets (`PipActivity.stripQuery`, `hasUrl=` boolean; `LlamaEngine` logs a fixed string).
- SDK currency: Capacitor 8.4.0, compile/target SDK 36, minSdk 24, iOS 16.0, Electron ^42.2.0, R8 on.
- The JS side honours the `registerPlugin` proxy trap the playbook records (`lib/assistant/native-model-download.ts:29`, `providers/native-llm.ts:57`, `providers/apple-intelligence.ts:277`).
- Electron secrets go through `safeStorage` with a null-not-plaintext failure path (`app/electron/main.cjs:95-117`).

### P7-1  iOS notification extension logs the rich-push image URL, token included

- **Severity:** MED, confirmed (new); device-pass-required
- **Site:** `app/ios/App/ImageNotification/NotificationService.swift:46,51,55,60` (`didReceive`), all `os_log(... %{public}@ ...)` with the raw, decoded, or absolute URL string (verified: four sites)
- **What is wrong:** The ES `picture_url` is logged four times at `.info`/`.error` with the `%{public}` privacy override, so it lands unredacted in the unified log (Console.app, sysdiagnose, any paired Mac). The user docs tell operators to authenticate that URL with a token (`docs/building/ANDROID.rst:289-293`), so the logged string carries a live ZM access token, or username and password on installs that never followed that advice. The prior review's "no native log statement carries a URL" was scoped to the app target and missed the extension.
- **Why it matters:** Same class as #307 (token in logcat) on the other platform; the native playbook line "never log a URL handed across the bridge" is violated and nothing gates it.
- **Fix:** Log `url.scheme`, `url.host`, and a `hasQuery` boolean, as `PipActivity.java:26-28,55` does; drop the "Decoded URL" and "Failed to parse" bodies or log only their lengths.
- **Verification:** The P7-2 gate proven red against this file before the edit. Device pass: send a rich push, confirm the image still attaches and Console shows no query string.
- **Effort:** S (4 lines, 1 file)
- **Risk:** loses URL detail when diagnosing a bad `picture_url`, which the docs already troubleshoot by config
- **Contracts:** I3, Logging, Native, M1

### P7-2  Native logging rule has no gate

- **Severity:** MED, confirmed (prior path-to-10 item, open)
- **Site:** `app/src/tests/agents-contracts.test.ts` (no case scans `.swift` or `.java`; verified by grep); `agents/project/native.md` says of native logging "Nothing gates it, so it is on you"
- **What is wrong:** M1 requires a gate for any rule a script can check; P7-1 is the drift M1 predicts, and the rule has now been violated on both platforms (#307, P7-1).
- **Fix:** A case in `agents-contracts.test.ts` that reads every `.swift`/`.java` under `app/ios/App` and `app/android/app/src/main/java`, flags lines matching `/(NSLog|os_log|CAPLog\.print|Log\.[dewiv])\(/` whose arguments contain `/\b(url|uri|absoluteString|getMessage\(\)|localizedDescription)\b/i` unless the line carries a `// log-safe:` reason. Whitelist nothing at first; the test must fail on `NotificationService.swift` before P7-1 lands (P2).
- **Verification:** `npm run gates` (vitest); proven-red CI job.
- **Effort:** S (1 test case)
- **Risk:** false positives on `error.localizedDescription` in `call.reject` strings; the regex is anchored on the log call
- **Contracts:** M1, M2, Logging, Native

### P7-3  media3 pinned three minor releases behind

- **Severity:** LOW, confirmed (new); device-pass-required
- **Site:** `app/android/app/build.gradle:74-77` (`androidx.media3:*:1.5.1`, verified)
- **What is wrong:** media3 1.5.1 (December 2024) against target SDK 36 and an otherwise current Capacitor 8 stack; 1.6 through 1.8 carry PiP and `MediaSession` fixes and 16 KB page-size fixes the Play console now flags.
- **Fix:** Bump the four coordinates together, rebuild, ride the next Android device pass with a PiP smoke (open, home, close, position returned via `PipPlugin.handlePipResult`). Standalone `chore:` per the native playbook.
- **Verification:** `build-all.yml` Android job compiles; device PiP smoke.
- **Effort:** S (4 lines)
- **Risk:** media3 1.6 renamed some `PlayerView` attributes; `PipActivity` uses only the programmatic API
- **Contracts:** Native playbook

### P7-4  TV global injected before the page exists

- **Severity:** LOW, theoretical (not counted)
- **Site:** `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/MainActivity.java:28-30` (`evaluateJavascript("window.__ZMNINJA_IS_TV__ = true;")` in `onCreate`); consumer `app/src/lib/platform.ts:73`
- **What is wrong:** `evaluateJavascript` runs in whatever document the WebView holds at that instant; `super.onCreate` has only just queued the app-URL load, so the global is set on the initial blank document and does not survive the navigation. Masked today because `checkIsTV` falls through to the `TvDetector.isTV()` bridge call and the UA regex.
- **Fix:** Delete the injection and the `__ZMNINJA_IS_TV__` branch (the plugin already answers), or inject from `WebViewClient.onPageStarted` as `SSLTrustPlugin.installWebViewSslHandler` does (`SSLTrustPlugin.java:329`). Deletion is the smaller change.
- **Verification:** Fire Stick pass: `Platform.isTVDevice` value at first render.
- **Effort:** S (2 sites)
- **Risk:** none if the plugin path is kept
- **Contracts:** C2, Native

### P7-5  Prior findings carried open, sites re-confirmed unchanged

Listed once so the executor has them; the 2026-08-06 text and fixes stand. All device-pass-required.

- **Prior P7-1, HIGH, confirmed:** `SSLTrustPlugin.swift:84-86` `getServerCertFingerprint` data-task closure is still `{ _, _, _ in session.invalidateAndCancel() }` (verified), so a DNS failure, refused connection, http portal, or timeout never settles the promise; no JS timeout at `app/src/lib/security/ssl-trust.ts:152`; awaited at `profile-bootstrap.ts:349` and `ProfileForm.tsx:236`. Android rejects (`SSLTrustPlugin.java:145-146,167`). Fix: resolve or reject in every closure branch, plus a JS-side timeout on the await.
- **Prior P7-2, MED, confirmed:** `SSLTrustPlugin.java:250-257` `HostnameVerifier` returns `enabled` for every host; `:276-283` the system-valid short-circuit precedes the pin. Additional site: the two-argument `checkServerTrusted(chain, authType)` (`:216-219`) passes `host = null`, so a caller on that overload never reaches the pin (theoretical today).
- **Prior P7-3, LOW, confirmed:** `GeminiNanoPlugin.download` (`GeminiNanoPlugin.java:157-187`) has no in-progress guard.
- **Prior P7-4, LOW, confirmed:** `LlamaPlugin.swift:36` "Mirrors Android's onTrimMemory"; `LlamaEngine.swift:131-132,239` reference `llama_jni.cpp`; the Android engine was removed (#306).
- **Prior P7-5, LOW, confirmed:** `#available(iOS 15.0, *)` at `SSLTrustPlugin.swift:149,311,403` and `SafeAreaPlugin.swift:88` under a 16.0 target; leaf-cert extraction still triplicated.
- **Prior P7-6, LOW, theoretical, partly addressed:** `trustedFingerprints` is now `volatile` (`SSLTrustPlugin.java:51`); `enabled` (`:50`) is not; the Swift "Rebuild atomically" comment (`SSLTrustPlugin.swift:53`) still overclaims; `LlamaPlugin.swift:100-105` download state unlocked; `GeminiNanoPlugin.java:209-211` check-then-set. New site of the same class: `WindowThemePlugin.lastColor` (`WindowThemePlugin.java:25`) written on the bridge thread and read on main without `volatile`.

Path to 10/10.

Worth it: P7-1 and P7-2 together in one PR (gate proven red on the leak, then the fix); prior P7-1 (the hang) and prior P7-2 (the pin) on the next iOS and Android device session, both S/M and security- or hang-class; prior P7-3, P7-4, P7-5 and this run's P7-3, P7-4 ride that same device pass as a batch.

Not worth it: an iOS compile job in CI (signing and the SPM `LlamaKit` checkout make it a day of work for a type-check the device pass already gives); per-profile TLS trust on Android or iOS (global trust is a recorded maintainer decision); native Gemini Nano cancellation, ML Kit `ModelConfig`, restoring Android llama.cpp, an iOS PiP plugin, Electron fingerprint pinning (all recorded non-goals); relaxing TLS in the notification extension so self-signed ES image URLs attach (the extension runs `URLSession.shared`, Android's FCM image path behaves the same, and the docs already steer `picture_url` to plain http).

## Pillar 8: Accessibility and UX robustness (7.9/10)

Strengths verified:

- Blocking a11y gate is clean: `npx eslint -c eslint.a11y.config.js .` printed nothing; the config enables the full jsx-a11y recommended set at error with every other rule off.
- Every icon-only `<Button size="icon">` carries an accessible name: brace-aware scan of 91 sites found 0 without `aria-label`/`title`/`aria-labelledby`. `Button` turns `title` into a hold-to-explain hint on touch (`app/src/components/ui/button.tsx:56-57`).
- No literal `aria-label="..."` strings in production JSX; names go through `t()`.
- Reduced motion handled at two layers with cross-referencing comments (`app/src/index.css:136-144`, `lib/view-transition.ts:24`, `ReturnFlashArrow.tsx:17`).
- Offline: `useNetworkStatus` uses Capacitor Network on native with a browser fallback; `OfflineBanner` is `role="status"`, mounted in `AppLayout.tsx:304`, key in all five locales; unit test exists.
- TV reachability: `useTvKeyHandler` routes d-pad keys; Montage and Timeline register maps; montage tiles are `role="button"` with `aria-label={Monitor.Name}` and a visible focus ring; `html.tv-mode` gives 20px base font and 4px focus ring.
- Pressed-state gate (`app/src/tests/control-consistency.test.ts`) enforces `default`/`outline` plus `aria-pressed`.
- Base touch targets 44px; compact mode floors `.h-11` at 32px, above the WCAG 2.2 24px minimum.
- Dark, slate, amber, and default light themes pass every computed core pair.
- `GridLayoutControls.tsx:189-191` fixed its 20px delete button with a `before:-inset-3` hit area (prior P8-5, one of three sites).

### P8-1  Cream secondary text and light and cream destructive text still fail WCAG AA

- **Severity:** MED, confirmed (prior P8-1 and P8-2, open; ratios recomputed from tokens, destructive on light 3.60:1 by the orchestrator's own calculation)
- **Site:** `app/src/index.css:366` `--muted-foreground: 28 12% 48%` (cream); `index.css:280-281` and `:369-370` `--destructive: 0 84.2% 60.2%` with near-white foreground (light, cream)
- **What is wrong:** Cream muted-on-background 3.77:1, on card 3.56:1, on muted 3.16:1; destructive-foreground on destructive 3.59:1 (light) and 3.40:1 (cream). Normal-text minimum is 4.5:1.
- **Why it matters:** `text-muted-foreground` is the app-wide secondary-text class; destructive buttons are the delete and disconnect confirmations.
- **Fix:** Darken cream `--muted-foreground` toward `28 14% 40%`, light and cream `--destructive` toward `0 72% 45%`, nudge slate muted. Add a vitest that parses the theme blocks in `index.css` and asserts the core pairs at 4.5:1; pattern: source-scanning gates such as `control-consistency.test.ts`.
- **Verification:** New vitest proven red against current cream and destructive values (P2), then green.
- **Effort:** S (5 token lines, 1 test)
- **Risk:** slightly less warm cream; visual spot-check on device
- **Contracts:** I3, M1, P2

### P8-2  Montage alarm state is invisible under reduced motion and to screen readers

- **Severity:** MED, confirmed (prior P8-3, open)
- **Site:** `app/src/components/monitors/MontageMonitor.tsx:270` (`isAlarming && "montage-alarm-pulse"`, the only conveyance, verified); `index.css:245-251` (`alarm-pulse` keyframes transparent at 0% and 100%); `index.css:136-144` forces one 0.01ms iteration
- **What is wrong:** Under `prefers-reduced-motion` the pulse freezes at transparent, so the alarm never shows. No `aria-*` or `role="status"` exposes `isAlarming`.
- **Why it matters:** Alarm indication in a security-monitoring app; a frozen spinner still reads as loading (documented tradeoff) but a pulse frozen at transparent conveys nothing.
- **Fix:** `@media (prefers-reduced-motion: reduce) { .montage-alarm-pulse { background-color: rgba(220,38,38,.35); } }` next to the keyframes, and a visually-hidden `role="status"` text on the header when alarming, keys in all five locales. Status-region pattern: `OfflineBanner.tsx:24`.
- **Verification:** Extend `components/monitors/__tests__/MontageMonitor.test.tsx` to seed a fresh event in the notifications store and assert the alarm text is in the accessible tree; red first.
- **Effort:** S (1 CSS block, 1 attribute, 5 locale keys, 1 test)
- **Risk:** low; tint only under reduced motion
- **Contracts:** I3, C3, Localization

### P8-3  `ErrorBanner` is not a live region

- **Severity:** MED, confirmed (new)
- **Site:** `app/src/components/ui/query-state.tsx:23-30` `ErrorBanner` (plain `<div>`, verified)
- **What is wrong:** No `role="alert"` or `aria-live`; every query failure in the app routes through this component (Query UI states contract), so a screen-reader user gets no announcement when a fetch fails after the page is focused.
- **Why it matters:** Query errors are the primary "your server is unreachable" signal on every list and detail page; sighted users see red, non-sighted users see nothing until they tab into it.
- **Fix:** Add `role="alert"` to the wrapper (or `role="status"` if too chatty on background refetch). Pattern: `OfflineBanner.tsx:24`.
- **Verification:** One assertion in the existing query-state consumer tests: `getByRole('alert')` returns the message; red first.
- **Effort:** S (1 site; all consumers inherit)
- **Risk:** none visual
- **Contracts:** I3, Query UI states

### P8-4  Thumbnail-chain reorder buttons remain 20x20 CSS px

- **Severity:** LOW, confirmed (prior P8-5, two of three sites open)
- **Site:** `app/src/components/settings/AppearanceSection.tsx:436` and `:449` (`size="icon"` with `className="h-5 w-5"`, verified; 12px glyphs, stacked adjacent)
- **What is wrong:** Below the WCAG 2.2 24x24 minimum; the spacing exception does not apply since the two are adjacent.
- **Fix:** Copy the `GridLayoutControls.tsx:189-191` pattern (`before:-inset-2` hit area) or use `h-6 w-6`.
- **Verification:** cosmetic tier; existing gates plus device look.
- **Effort:** S (2 sites)
- **Risk:** none
- **Contracts:** I3

### P8-5  a11y gate omits the two rules that catch an unnamed control

- **Severity:** LOW, confirmed (prior P8-4, open)
- **Site:** `app/eslint.a11y.config.js:64-65` spreads `jsxA11y.flatConfigs.recommended.rules`, which ships `control-has-associated-label` off and does not include `no-aria-hidden-on-focusable`
- **What is wrong:** 91/91 named icon buttons is a fact, not a gate; a new unnamed `<Button size="icon">` passes CI.
- **Fix:** Add both rules at error inside the same config object, scope with `ignores: ['**/__tests__/**']` if the test mocks trip them.
- **Verification:** M2-style input check: delete an `aria-label` from a montage button locally and confirm the gate turns red.
- **Effort:** S
- **Risk:** none
- **Contracts:** M1, M2, I3

### P8-6  Spatial-navigation failure is silent on TV devices

- **Severity:** LOW, theoretical (prior P8-6, open; not counted)
- **Site:** `app/src/lib/tv/tv-spatial-nav.ts:22-24` empty `catch` (verified); `:21` success log uses `log.auth`
- **What is wrong:** On a real TV, a plugin failure leaves the d-pad dead on every page except Montage and Timeline with zero diagnostics; wrong log category.
- **Fix:** `log.<ui or native category>(..., LogLevel.WARN)` in the catch when `Platform.isTVDevice`; fix the success category.
- **Verification:** Unit test with a mocked `registerPlugin` rejection asserting the WARN call; red first.
- **Effort:** S
- **Risk:** none
- **Contracts:** Logging, P2

### P8-7  Hardcoded "TV" label in the collapsed sidebar

- **Severity:** LOW, confirmed (new)
- **Site:** `app/src/components/layout/SidebarContent.tsx:488` `{isCollapsed ? 'TV' : t('sidebar.tv_mode')}` (verified)
- **What is wrong:** Literal user-facing string beside a localized one; the localization gate did not catch quoted JSX text inside a ternary.
- **Fix:** Add `sidebar.tv_mode_short` to all five locales.
- **Verification:** extend the hardcoded-string check in `agents-contracts.test.ts` to quoted JSX text in ternaries, or accept review (M2).
- **Effort:** S (1 site, 5 locale lines)
- **Risk:** none
- **Contracts:** C3, Localization

Path to 10/10.

Worth it: P8-1 with the token-contrast vitest (the only way the a11y gate's zero ever speaks to colour); P8-2 (security-relevant state with no non-motion channel); P8-3 (one attribute, inherited everywhere); P8-5 while it is a handful of mechanical edits.

Not worth it: enlarging the `h-6`/`h-7` icon buttons already at or above 24px (dense toolbars, 320px label rule); converting `title`-only names to `aria-label` (`title` computes a valid name and long-press covers touch); axe-core in e2e (static classes are covered; runtime axe adds flake against the shared server); captions for CCTV streams; offline data persistence (stale camera frames mislead); an offline banner on the pre-login routes outside `AppLayout` (the probe error already says the server is unreachable).

## Pillar 9: Build, CI, dependency health (7.6/10)

Strengths verified:

- The hard and advisory split is explicit and mirrored in CI and hook: `ci.yml` `lint` job runs `npm run lint` under `continue-on-error: true` with the #217 rationale inline, then `npm run lint:ratchet` hard; `.husky/pre-commit` runs a11y, correctness, and `tsc -b` hard.
- Branch protection live-verified (`gh api`): six required contexts, `allow_force_pushes: false`, `allow_deletions: false`.
- Hook bypass defended in CI: the `native-version-guard` job re-runs `scripts/check-native-version-bump.mjs --ci` over every commit.
- Script tests now run in CI (`ci.yml` `proven-red` job, `npm run test:scripts`); prior P9-3 fixed.
- lint-staged has a config: `app/.lintstagedrc.json` exists and the hook does `cd app` first; prior P9-2 fixed.
- The e2e skip is loud in `ci.yml:241` ("Report that no E2E test ran" with `::warning` and a step summary); prior P9-1 fixed for `ci.yml`.
- `concurrency.cancel-in-progress` keeps every main commit with a completed status; `fetch-depth: 0` where the hash test needs it.
- No dead package.json script targets; workflow permissions least-privilege where they matter; no `pull_request_target` anywhere.
- linux-arm64 runs native (`build-linux-arm64.yml:19` `runs-on: ubuntu-24.04-arm`, Node 22, verified).
- The prior review's "label-guard required context" strength no longer applies: the workflow was dropped in 136654f9 and the context is gone from branch protection, so no stale required check blocks merges.

### P9-1  proven-red job is not a required status check

- **Severity:** MED, confirmed (same as P13-3; counted once, under Pillar 13)
- **Site:** branch protection on `main` lacks `proven-red` (verified: six contexts); `ci.yml` job `proven-red`; `docs/developer-guide/14-agent-development-model.rst:275` "The proven-red job is the newest and is not yet in the required list"
- **What is wrong:** P2's only machine gate and the `test:scripts` step that guards the native-version script both live in a job auto-merge ignores.
- **Fix:** See P13-3; then delete the sentence at `14-agent-development-model.rst:275`.
- **Effort:** S (1 setting plus 1 doc line)
- **Contracts:** P2, P3, M1, M2

### P9-2  Dependency audit has grown: 37 vulnerabilities in app, 19 at root

- **Severity:** MED, confirmed by raw output (prior P9-5, open and worse)
- **Site:** `app/package-lock.json` (`37 vulnerabilities (1 low, 7 moderate, 28 high, 1 critical)`); root `package-lock.json` (`19 vulnerabilities (1 low, 1 moderate, 17 high)`). Prior counts 22 and 9. Critical is still `tar` under `@capacitor/cli`. Direct deps flagged: `react-router-dom@7.18.1` high, `electron` high, `@capacitor/assets` high, `playwright-bdd@8.5.1` moderate, six `@wdio/*` high; plus the `sharp` libvips advisory line.
- **What is wrong:** No `.github/dependabot.yml`; `.github/release.yml` excludes `dependabot` as an author for a bot that never runs; no `npm audit` step in any workflow.
- **Why it matters:** `react-router-dom` and `electron` are runtime for shipped desktop installers; the number went up 68% since the prior finding recommended a fix.
- **Fix:** `npm audit fix` in both dirs; bump `react-router-dom`, `electron`, `playwright-bdd`; add `.github/dependabot.yml` (npm for `/app` and `/`, plus `github-actions`, weekly, grouped). Optionally an advisory `npm audit --audit-level=critical` step in `ci.yml` `build`, `continue-on-error: true`, same pattern as the advisory lint step.
- **Verification:** `npm audit` in both dirs; `npm run gates`; one local `npm run test:e2e -- <feature>.feature` because playwright-bdd's generator changes.
- **Effort:** M (2 lockfiles, 3 to 4 version bumps, 1 new file)
- **Risk:** electron and react-router minor bumps can change behaviour; one bump per commit (P5)
- **Contracts:** I3, C1

### P9-3  test.yml e2e job still silently green on skip

- **Severity:** LOW, confirmed (prior P9-1, half fixed)
- **Site:** `.github/workflows/test.yml` job `e2e-tests` (every step `if: has_secrets == 'true'`); no warning or summary step (verified: grep for "Report that no E2E" hits only `ci.yml`)
- **What is wrong:** `test.yml` runs on `release: published`, so the release-time run shows a green e2e job that ran nothing.
- **Fix:** Copy the `ci.yml:241` step verbatim into `test.yml` after "Check E2E secrets".
- **Verification:** next release run shows the `::warning` annotation.
- **Effort:** S (1 site)
- **Risk:** none
- **Contracts:** M2

### P9-4  Domain playbook records a qemu and Node 18 arm64 job that does not exist

- **Severity:** LOW, confirmed (prior P9-4, open; same as P13-6, counted once under Pillar 13)
- **Site:** `agents/project/domain-context.md:268-270`; actual `build-linux-arm64.yml:19` `runs-on: ubuntu-24.04-arm`, `:29` `node-version: '22'`; no qemu in any workflow (verified)
- **Fix:** See P13-6.

### P9-5  tsx used by test:platform:setup but undeclared

- **Severity:** LOW, confirmed (prior P9-7, open)
- **Site:** `app/package.json` script `test:platform:setup: "tsx ../scripts/verify-platform-setup.ts"`; `npm ls tsx` resolves only via `@wdio/cli`
- **What is wrong:** Resolves by hoisting only; a wdio major bump breaks the onboarding script.
- **Fix:** `npm i -D tsx` in app, or rewrite `scripts/verify-platform-setup.ts` as `.mjs` (it uses only `child_process`, `fs`, `path`; `scripts/proven-red.mjs` is the pattern).
- **Verification:** `npm run test:platform:setup` after `rm -rf node_modules && npm ci`.
- **Effort:** S
- **Risk:** none
- **Contracts:** C1

### P9-6  Release actions on mutable major tags

- **Severity:** LOW, confirmed (prior P9-6, open)
- **Site:** `softprops/action-gh-release@v1` at `build-android.yml:112`, `build-linux-amd64.yml:73`, `build-linux-arm64.yml:73`, `build-macos.yml:86`, `build-windows.yml:67` (all under `contents: write`); `codecov/codecov-action@v4` in `test.yml`; `ruby/setup-ruby@v1` in `create-release.yml:22`; `anthropics/claude-code-action@v1` in `claude.yml`
- **What is wrong:** Third-party actions with release-write are tag-pinned; a tag re-point runs arbitrary code with rights to publish installers.
- **Fix:** Pin the third-party actions to full commit SHAs with a `# vX.Y.Z` comment; bump `action-gh-release` to v2. Dependabot with `github-actions` (P9-2) keeps the SHAs current.
- **Verification:** one `workflow_dispatch` of `build-linux-amd64.yml` producing a release asset.
- **Effort:** S (8 sites)
- **Risk:** v1 to v2 input renames on `action-gh-release`
- **Contracts:** I3

### P9-7  Tracked file ignored by its own .gitignore

- **Severity:** LOW, confirmed (prior P9-8, open)
- **Site:** `git ls-files -i -c --exclude-standard` prints `desktop_release_builds/tauri/.gitkeep` (verified, sole hit)
- **Fix:** `git rm desktop_release_builds/tauri/.gitkeep`.
- **Effort:** S
- **Risk:** none
- **Contracts:** C2

### P9-8  Root devDependency @wdio/cli has no root consumer

- **Severity:** LOW, confirmed (new)
- **Site:** `package.json:43` `"@wdio/cli": "^9.26.1"` (verified); added in `22d02763 docs:updates`. No `wdio*` config at root; both device scripts run `npx wdio` after `cd app`, where `app/package.json` already declares it.
- **What is wrong:** A second copy of the wdio tree doubles the audit surface and root `npm install` time for zero use; the root audit count in P9-2 is largely this.
- **Fix:** Remove `@wdio/cli` from root `devDependencies`, `npm install` at root to regenerate the lockfile.
- **Verification:** `bash scripts/test-android.sh --help` still resolves `wdio` from `app/node_modules/.bin` (manual-only device path; do not auto-run); root `npm audit` count drops.
- **Effort:** S (1 site plus lockfile)
- **Risk:** theoretical: a root-level `npx wdio` in a maintainer's shell history stops working
- **Contracts:** C1, C2

### P9-9  Root .gitignore Capacitor block targets a path that does not exist at root

- **Severity:** LOW, confirmed, cosmetic (new)
- **Site:** `.gitignore` "Capacitor/Android" block (`android/app/build/`, `android/keystore.properties`, and siblings); the Android project lives at `app/android/` and `app/.gitignore` carries the identical block
- **What is wrong:** Dead ignore rules claiming coverage they do not provide; harmless today because the nested file does the work.
- **Fix:** Delete the block from root `.gitignore` (keep `*.jks`, `*.keystore`, `**/capacitor.*.gradle`).
- **Verification:** `git status --ignored app/android | head` unchanged before and after.
- **Effort:** S
- **Risk:** none
- **Contracts:** C2

Path to 10/10.

Worth it: P13-3 (one API call closes the P2 gap the repo's own doc admits); P9-2 audit fix plus dependabot (stops the count drifting upward between reviews); P13-6 (a false instruction in a file agents are told to trust); P9-8 (halves root audit noise and install time); P9-3, P9-5, P9-6, P9-7, P9-9 as a single `chore(ci):` sweep.

Not worth it: hard-gating full `npm run lint` before the backlog burns down (the ratchet holds the line); requiring the `e2e-tests` context (needs live-server secrets; would block fork PRs or always-skip); requiring PR reviews on a solo-maintainer repo; `strict: true` on required checks (auto-merge with up-to-date enforcement would need a rebase loop per PR); consolidating the five per-platform build workflows (each standalone dispatch is the recovery path when one platform needs a rebuild); running `test.yml` on PRs (it duplicates `ci.yml` with coverage upload); device e2e in CI (manual-only by project rule); adding `.nvmrc` (`engines.node >=22` and every workflow already agree).

## Pillar 10: Documentation and handover (4.9/10)

Strengths verified:

- Every `blob/main/<path>` link in `docs/developer-guide/*.rst` and `docs/user-guide/*.md` resolves to an existing file (scripted over all unique paths; zero misses).
- `ASSISTANT.maxToolIterations` = 6 matches `app/src/lib/zmninja-ng-constants.ts:668`, cited in `15-assistant.rst:14` and `call-flows.rst:2165`.
- `docs/user-guide/keyboard-shortcuts.md:18-28` matches `NAV_SHORTCUTS` key-for-key.
- Flow 21 (`call-flows.rst:2739-2752`) describes `useScopedMonitors` accurately: per-profile keys, `combine`, `errors` array, no auth gate. It is the template for P10-2 and P10-6.
- `16-platform-surfaces.rst:119-131` correctly states `useBiometricAuth.ts` exports functions, not a hook.
- Recent feature PR #386 (1e66b061) shipped with `11-application-lifecycle.rst`, `call-flows.rst`, and `user-guide/settings.md` in the same commit (P10 followed).
- Flow 16 (`call-flows.rst:1637-1646`) matches `pages/Profiles.tsx:107-114` exactly.

### P10-1  Four chapters still teach the retired HTTP singleton

- **Severity:** HIGH, confirmed (prior P10-1, open; 16 sites unchanged)
- **Site:** `03-state-management-zustand.rst:391,394`; `07-api-and-data-fetching.rst:78,82,105,135,156,313,314,1080`; `12-shared-services-and-components.rst:266,1667`; `call-flows.rst:144,145,750,1738`. `getSession` is still absent from call-flows, chapter 03, and chapter 12.
- **What is wrong:** `getApiClient`/`setApiClient` are the symbols the Sessions contract gate forbids in `app/src` (`agents-contracts.test.ts:269`); the developer guide teaches them as the path.
- **Why it matters:** A contributor following the guide writes code the contract gate rejects, then reads the gate failure without knowing which doc lied.
- **Fix:** Rewrite the 16 sites onto `getSession` / `createStoreApiClient`; add a doc-side forbidden-symbol test over `docs/developer-guide/*.rst` covering `setApiClient|getApiClient|resetApiClient|applySSLTrustSetting|storeGates`, proven red. This single test is the M1 gate the whole pillar lacks; nothing in `app/src/tests/` checks developer-guide symbol truth.
- **Verification:** the new test red on current docs, green after.
- **Effort:** M (16 sites, 4 files, 1 test)
- **Risk:** none
- **Contracts:** P10, Sessions, M1

### P10-2  Flows 1 and 2 describe an auth-gated single monitors query

- **Severity:** MED, confirmed (prior P10-2, open)
- **Site:** `call-flows.rst:196` ("gated on ``isAuthenticated``"); `:236-242` (a single `useQuery` in Montage)
- **What is wrong:** Both pages use `useScopedMonitors`, whose inline comment records the auth gate as removed (refs #337).
- **Fix:** Rewrite both steps on the Flow 21 template.
- **Effort:** S (2 sites)
- **Contracts:** P10, Aggregation

### P10-3  Line-anchored source links have rotted

- **Severity:** MED, confirmed by sampling (prior P10-3, open)
- **Site:** `call-flows.rst`: 246 `#L<n>` anchors, unchanged count; sample `profile-bootstrap.ts#L266` for `bootstrapSSLTrust`, actually at line 323
- **Fix:** Strip `#L` anchors (the symbol name is what survives; the testing playbook already says briefs cite symbols, never lines) and gate with a no-`#L` test.
- **Effort:** M (246 mechanical edits, one sed, plus the test)
- **Contracts:** P10

### P10-4  Flow 6 names `checkAndRefresh`; the hook exports `checkAndRefreshAll`

- **Severity:** LOW, confirmed (prior P10-4, open)
- **Site:** `call-flows.rst:701`; `hooks/useTokenRefresh.ts:50`
- **Fix:** one-word fix.
- **Effort:** S
- **Contracts:** P10

### P10-5  `applySSLTrustSetting` documented at seven sites; the symbol does not exist

- **Severity:** HIGH, confirmed (new; orchestrator verified: 7 hits in `docs/developer-guide`, 0 in `app/src`)
- **Site:** `call-flows.rst:162` (Flow 1 step 6), `:509` (Flow 4 step 4), `:535` (Flow 4 step 7), `:1674` (Flow 16 `handleUpdateProfile`); `12-shared-services-and-components.rst:150,153,175` (import, code sample with a two-argument signature, Electron paragraph). Also in the stale spec `docs/superpowers/specs/2026-08-02-all-profiles-design.md:263`.
- **What is wrong:** `app/src/lib/security/ssl-trust.ts` exports `collectTrustEntries`, `applyTrustedCertificates(candidate?: TrustCandidate)`, `getServerCertFingerprint`, `bootstrapSSLTrust` (lines 60, 103, 148, 323). The real callers use `applyTrustedCertificates({ urls, fingerprint, enabled })` (`ProfileForm.tsx:154-155`, `Profiles.tsx:166-170`; `profile-bootstrap.ts:329` for the boot path).
- **Why it matters:** A contributor copying the chapter 12 sample gets a compile error; a reader of Flow 4 or 16 looks for a function that is not there. TLS trust is a security path; wrong docs here cost more than elsewhere.
- **Fix:** Rewrite the seven sites onto `applyTrustedCertificates` / `TrustCandidate` and `bootstrapSSLTrust`; the sanctioned wording already exists as comments in `ssl-trust.ts:60-110`. Add the symbol to the P10-1 forbidden-symbol scan.
- **Verification:** the P10-1 doc-symbol test, proven red against current docs.
- **Effort:** S (7 sites, 2 files)
- **Risk:** low; symbol rename only
- **Contracts:** P10, Native, Sessions

### P10-6  Flow 5 "Run the events query" describes the retired single-profile query

- **Severity:** MED, confirmed (new; verified at `call-flows.rst:591-596`)
- **Site:** `call-flows.rst:591-600` (Flow 5 step 3: "keyed by ``queryKeys.eventsList(...)`` calls ``getEvents`` ... gated on auth")
- **What is wrong:** `pages/Events.tsx` imports `useScopedEvents` (line 19), not `getEvents`; `useScopedEvents.ts:203-210` sets `enabled: enabled ?? true` with a comment explaining the auth gate was removed (refs #337). Same defect class as P10-2 on a third flow.
- **Why it matters:** A reader "restores" the missing auth gate and reintroduces the All-mode silent-blank bug the comment warns about.
- **Fix:** Rewrite the step around `useScopedEvents` and its `combine`, mirroring Flow 21.
- **Effort:** S (1 site)
- **Risk:** low
- **Contracts:** P10, Aggregation, Server queries

### P10-7  Developer notices feature has no user-guide coverage

- **Severity:** LOW, confirmed (new; verified: zero hits in `docs/user-guide/*.md`)
- **Site:** feature at `app/src/pages/DeveloperNotice.tsx`, route `/developer-notice`, banner `components/layout/DeveloperNoticeBanner.tsx:29-45`, settings toggle `show_developer_notices`; only `faq.md:144` alludes to "the maintainer notices feed"
- **What is wrong:** A user-visible banner, a page, and a Settings toggle exist; the user guide never names them. The prior review's "no page gap" strength no longer holds.
- **Fix:** Short section in `settings.md` under the existing toggles, plus a one-line pointer in `faq.md:144`.
- **Effort:** S (2 files)
- **Contracts:** P10, Localization

### P10-8  Flow 6 step 9 names `storeGates`; the module exports `makeProfileGates` and `createStoreApiClient`

- **Severity:** LOW, confirmed (new; verified at `call-flows.rst:743`)
- **Site:** `call-flows.rst:743-746`; `app/src/api/store-gates.ts` exports `resetAuthGates`, `makeProfileGates`, `createStoreApiClient`
- **Fix:** Name the real symbols; fold into the P10-1 rewrite (same paragraph block as `:750`).
- **Effort:** S (1 site)
- **Contracts:** P10, Sessions

Path to 10/10.

Worth it: P10-1, P10-5, and P10-8 in one editing pass with the forbidden-symbol test; P10-2 and P10-6 together onto the Flow 21 template; P10-3 with its no-anchor test; P10-4; P10-7.

Not worth it: a generic "every backticked symbol must exist in the linked file" test (a probe produced ~60 false positives from adjacent-step symbols, JSX props, and native Swift and Kotlin names; a small forbidden-symbol list is the tractable gate); re-verifying `docs/_build/html`; chapter renumbering (the 07-to-09 gap breaks no link).

## Pillar 11: Error handling and trust boundaries (8.4/10)

Strengths verified:

- Schema tolerance is systematic: `api/types.ts` has 23 `withFieldCatch` and 13 `tolerantArray` uses; every `api/*.ts` module except `notifications.ts` calls `validateApiResponse`.
- `getMonitorEventsSince` (`api/events.ts:311-314`) documents why it skips Zod; a recorded simplification.
- Bulk delete is the model destructive path (`hooks/useBulkDeleteEvents.ts:66-160`): grouped by profile, `Promise.allSettled`, permission refusal distinguished, partial counts toasted, cache-failure reasoning inline.
- Profile delete tears everything down (`stores/profile.ts:275-337`); `ProfileService.deletePassword` WARN-logs so a Keychain failure cannot block the delete.
- Abort misdetection guard exists (`lib/is-abort-error.ts:10-16`); the Electron adapter rebuilds an abort as a real `DOMException`; Electron main returns transport failures as a structured envelope.
- Electron IPC secret handlers validate argument type and never throw (`electron/main.cjs:102-118`).
- Persisted auth state is parsed defensively; store rehydration cannot hang the app (`stores/profile.ts:695-725`).
- Malformed input from external sources degrades per record (log-file lines, ES frames, QR payloads).
- All 25 comment-only catch bodies sit on non-fatal paths (sampled).

### P11-1  `api/notifications.ts` returns bare casts with no schema

- **Severity:** MED, confirmed (prior P11-1, open; verified: zero `validateApiResponse` or `z.` in the module)
- **Site:** `app/src/api/notifications.ts:60-61` (`registerToken`), `:88-89` (`updateNotification`): `resp.data.notification.Notification` through `client.postForm<NotificationResponse>`
- **What is wrong:** A ZM server without the notifications API, a proxy answering 200 HTML, or a missing `notification` field produces a `TypeError` on property access instead of a diagnosable validation error.
- **Why it matters:** The TypeError lands in the log-only catch at `services/pushNotifications.ts:456-458` (P11-2), so direct-mode push registration fails with a "Cannot read properties of undefined" log line and no user signal.
- **Fix:** `z.object(withFieldCatch({ Id: z.coerce.number(), ... }, ['Id']))` wrapped in a response schema and `validateApiResponse(schema, resp.data, { endpoint, method })`, as `api/users.ts:45-50` does; add the schema to `api/__tests__/types.test.ts` per the data-integrity playbook.
- **Verification:** schema test with a drifted payload proven red against the cast; `npm run gates`.
- **Effort:** S (2 sites, 1 schema)
- **Risk:** over-strict fields rejecting a live response; device pass on a real server
- **Contracts:** I1, P2, data-integrity playbook

### P11-2  Direct-mode push registration failure is log-only while the UI reports active

- **Severity:** MED, confirmed (prior P11-2, open; verified at `pushNotifications.ts:456-458`)
- **Site:** `services/pushNotifications.ts:456-458` (catch body is one `log.push(..., LogLevel.ERROR, error)`); `pages/NotificationSettings.tsx:290-294` renders `notifications.status.direct_active` keyed on `mode === 'direct' && settings?.enabled`
- **What is wrong:** The status line reflects intent (the toggle), not outcome (`settings.notificationId` set by a successful register at `:454`). The ES branch at `NotificationSettings.tsx:201` already toasts `connect_failed`.
- **Why it matters:** User enables direct push, sees "active", never gets a notification, and has no diagnostic short of reading logs.
- **Fix:** Derive the status line from `settings.notificationId` presence and toast on the user-initiated path (`handleEnableToggle`, `NotificationSettings.tsx:129-151`), mirroring the ES branch; new keys in all five locales.
- **Verification:** unit test: rejected `registerToken` leaves `notificationId` unset and the status renders the failure key, red pre-fix; real round-trip is a device pass.
- **Effort:** S/M (2 sites plus locale keys)
- **Risk:** background re-registration must not nag; scope the toast to user-initiated flows
- **Contracts:** I2, C3, Notifications

### P11-3  Three `api/server.ts` host-stat schemas are plain `z.object`

- **Severity:** LOW, confirmed (prior P11-3, open)
- **Site:** `api/server.ts:51-57` (`LoadSchema`), `:59-77` (`DiskPercentSchema`), `:79-81` (`DaemonCheckSchema`); siblings at `:83` use `withFieldCatch`
- **What is wrong:** One drifted field fails the whole call, blanking the entire server-stats surface.
- **Fix:** wrap in `withFieldCatch` as `StorageSchema` does; choose fallbacks that render as unknown, not `0`.
- **Verification:** `api/__tests__/types.test.ts` case with a drifted `load`, red pre-fix.
- **Effort:** S (3 schemas)
- **Risk:** none material
- **Contracts:** I1

### P11-4  `instanceof DOMException` abort checks grew from 2 sites to 5

- **Severity:** LOW, confirmed inconsistency; impact theoretical (prior P11-4, open and worse; verified: 5 sites outside `is-abort-error.ts`)
- **Site:** `lib/assistant/window-interpreter.ts:261`, `lib/assistant/timeframe-stage.ts:220`, `lib/assistant/triage.ts:174`, `lib/assistant/contract-eval.ts:181`, `components/assistant/AskPanel.tsx:710`; `lib/is-abort-error.ts:10` exists for exactly this
- **What is wrong:** Three new sites copied the pattern since the prior review instead of the helper. Every in-repo adapter rejects aborts with a real `DOMException` today, so the check works; any provider that rejects with a plain `{ name: 'AbortError' }` (Capacitor plugin rejections are plain objects) makes `triage.ts:174` silently answer `'zoneminder'` and `window-interpreter.ts:261` cache the abort as a failed interpretation.
- **Why it matters:** The drift direction is wrong; the failure mode when it bites is a cache-poisoning edge.
- **Fix:** Replace all five with `isAbortError(error)`; add an `agents-contracts.test.ts` grep forbidding `instanceof DOMException` outside `is-abort-error.ts` so it stops regrowing (M1).
- **Verification:** unit test for `interpretWindow` rejecting with a plain object named `AbortError`, asserting rethrow-not-cache, red pre-fix; grep gate.
- **Effort:** S (5 sites)
- **Risk:** none
- **Contracts:** I1, C1, M1

### P11-5  Raw `error.message` reaches users at nine sites, three with hardcoded English fallbacks

- **Severity:** LOW, confirmed (prior P11-5, open; the three literals verified)
- **Site:** `pages/Profiles.tsx:238,277,299`, `pages/Logs.tsx:374`, `pages/NotificationSettings.tsx:201`, `pages/ProfileForm.tsx:352`, `components/profiles/VirtualProfileDialog.tsx:89`, `hooks/useGo2RTCStream.ts:290`, `components/events/Mp4EventPlayer.tsx:280`. Hardcoded fallbacks: `'Unknown error'` (`NotificationSettings.tsx:201`), `'Connection failed'` (`useGo2RTCStream.ts:290`), `'An unknown error occurred'` (`Mp4EventPlayer.tsx:280`)
- **What is wrong:** Transport and Zod prose bypasses `resolveQueryError`; three fallbacks are literal English that the localization gate did not catch.
- **Fix:** Route through `resolveQueryError` or the localized fallback alone, keeping the raw message in the adjacent `log` call (pattern: `AskPanel.tsx:715-718`). Replace the three literals with `t('common.error')` as `VirtualProfileDialog.tsx:89` does.
- **Verification:** extend the hardcoded-string check in `agents-contracts.test.ts` to string literals in `setError(`/`toast` arguments, red pre-fix.
- **Effort:** M (9 sites plus locale keys); the three literals alone are S
- **Risk:** losing a useful native message (`AssistantNativeSection.tsx:133-138` documents when that is intended; leave it)
- **Contracts:** C3, Query UI states

### P11-6  `getConsoleEvents` trusts an unverified endpoint through a bare cast

- **Severity:** LOW, theoretical (prior P11-6, open; not counted)
- **Site:** `api/events.ts:426-433`
- **Fix:** `z.record(z.string(), z.coerce.number().catch(0))` through `validateApiResponse`, or a `Number.isFinite` filter.
- **Effort:** S (1 site)
- **Contracts:** I1

### P11-7  Electron `http:request` IPC handler validates nothing about `req`

- **Severity:** LOW, theoretical (new; not counted)
- **Site:** `electron/main.cjs:28-29` (verified: destructures `req` with no type checks); siblings `secure:encrypt`/`secure:decrypt` at `:102-118` do `typeof` gates
- **What is wrong:** An undefined `req` throws before the try, the exact unhandled rejection the catch comment at `:63-67` says it avoids. `preload.cjs` forwards `req` verbatim under `contextIsolation`, so the only caller is first-party; impact today is nil.
- **Fix:** `if (!req || typeof req.url !== 'string') return { ok: false, error: { name: 'TypeError', message: 'bad request' } }` at the top, matching the envelope at `:69-77`.
- **Verification:** `electron/__tests__/main.test.ts` malformed-`req` case, red pre-fix.
- **Effort:** S (1 site)
- **Contracts:** I1

### P11-8  ES alarm payload fields are used unchecked

- **Severity:** LOW, theoretical (new; not counted)
- **Site:** `services/notifications.ts:428` (`JSON.parse(event.data) as ZMNotificationMessage`), `:460-461`, `:475-477`
- **What is wrong:** Only `message.events` truthiness is checked; a non-array throws `TypeError` in `for..of` and is logged as "Failed to parse notification message", a misleading diagnosis.
- **Fix:** `Array.isArray(message.events)` guard and `String(event.EventId)` coercion, or a small `withFieldCatch` schema.
- **Verification:** `stores/__tests__/notifications.test.ts` case with `events: {}`, red pre-fix.
- **Effort:** S (1 site)
- **Contracts:** I1, Notifications

Path to 10/10.

Worth it: P11-1 plus P11-2 together (one user-facing defect: push that fails dark); P11-4 with a grep gate so the count stops regrowing; P11-3 (three-line change); P11-5's three hardcoded English fallbacks.

Not worth it: Zod on `getMonitorEventsSince` (documented decision); typed-error machinery over the 25 justified comment-only catches; toasting background failures that degrade correctly (PiP exit, QR scanner stop, badge sync); the remaining message-extraction `instanceof Error` sites (the `String(err)` arm loses nothing); full P11-5 localization of transport prose beyond the literals (the raw message is often the most useful diagnostic the user has); P11-7 and P11-8 beyond the one-line guards.

## Pillar 12: Security (not assessed)

Skipped by maintainer instruction for this run, as on 2026-08-06. Items with a security dimension found by other pillars: P7-1 (token in iOS extension logs), prior P7-2 carried in P7-5 (Android pin bypass), P9-6 (mutable release-action tags), P9-2 (runtime dependency advisories), P11-7 (IPC argument validation).

## Pillar 13: Instruction system overhead (5.0/10)

Scale of what every session loads: `AGENTS.md` 823 words, `AGENTS.project.md` 1230, `CLAUDE.md` 14, total 2067 of the 2100-word budget. Playbooks loaded on demand: `agents/**` 7908 words (domain-context 2722, claude-workflows 1506, llm-models 1353, testing 831). Skills loaded on trigger: 4158 words.

Strengths verified:

- The word budget is a real ratchet with reasons in the file (`agents-contracts.test.ts:124`, two dated raises each naming what paid for them).
- Domain-context evidence is machine-checked: every commit hash cited must exist (`agents-contracts.test.ts:155`), and CI checks out `fetch-depth: 0` for it.
- The P2 gate is real and fires: `scripts/proven-red.mjs` ran on PRs 387, 388, 389 and each log reads `proven-red: changed tests fail on the pre-change code, as they should.`
- Gate and CLI cannot disagree: `quality-ratchet.mjs` exports `currentCounts` and `quality-ratchet.test.ts` imports it.
- One contract is honest about being ungated (Aggregation, `Gate: review; mechanizing these is a tracked follow-up`).
- The native version guard runs as a commit-msg hook and again in CI on every commit, so `--no-verify` cannot bypass it.
- The Sessions contract is fully mechanized with an explicit allowlist (`agents-contracts.test.ts:241-292`); it is the template the other contracts should copy.
- `no-circular-deps.test.ts` walks imports itself instead of adding madge as a dependency (C1).
- The out-of-scope ledger stops a known churn class (`out-of-scope.md:9-11`).
- The Never clauses a grep could check are, today, green (see Pillar 3 strengths), so mechanizing them costs nothing in burn-down.

### P13-1  Eleven Gate lines cite a test that asserts none of their Never clauses

- **Severity:** MED, confirmed (absorbs P3-1 and prior P4-3)
- **Site:** `AGENTS.project.md` Gate lines for Settings, Polling, HTTP, Logging, Server queries, Stores, Query UI states, Date and time, Localization, Native, Constants, each `Gate: app/src/tests/agents-contracts.test.ts; review`; the test's contract block (`:56-93`) checks only that four field labels exist and that backticked symbols resolve
- **What is wrong:** A reader following `agents/generic/claude-workflows.md` ("skipping anything a gate enforces") skips review of eleven contracts that nothing enforces. Where the clause is cheap to break, drift is visible: Settings says `Never: direct storage access`, and `components/ui/collapsible-card.tsx:31,50`, `components/settings/SettingsLayout.tsx:36`, `components/settings/AppearanceSection.tsx:265,367`, `lib/assistant/providers/provider.ts:26` call `localStorage` directly (verified). Those are non-profile UI toggles, so the clause is either wrong-scoped or violated; either way the gate line is fiction.
- **Why it matters:** M2 in the instruction file itself: eleven green gate references that measure prose shape. Every session pays to read them and gets false assurance in return.
- **Fix:** One new `describe` in `agents-contracts.test.ts` modeled on the Sessions block, with the cheap assertions: `console.` outside `lib/logger.ts` and `lib/log-file/`; `\bfetch(`/`axios` outside `lib/http/`; `from '@capacitor/<not core>'` static anywhere; `queryKey: [` outside `lib/query/`; `^import .* from '../stores/` inside `services/` (P3-2); `instanceof DOMException` outside `is-abort-error.ts` (P11-4). All are green today except the two that P3-2 and P11-4 fix, so no ratchet is needed. Then reword the Gate lines that still need judgment (Settings, Polling, Stores, Query UI states, Date and time, Localization hardcoded-string half, Constants) to the Aggregation form `Gate: review.`, and have Localization cite its real gate, `app/src/locales/__tests__/translation-keys.test.ts`, which no contract names. Route through M3. Surviving gate: `agents-contracts.test.ts`, now asserting what it is cited for.
- **Verification:** Each new assertion proven red with a scratch violation (P2; `scripts/proven-red.mjs` will demand it since the test file changes), then `vitest run src/tests/agents-contracts.test.ts` green; the Gate-line rewording is covered by the existing four-lines assertion.
- **Effort:** S for the greps (one file, ~50 lines) plus S for eleven one-line edits
- **Risk:** false positives in comments (the `queryKey` doc comment at `useBandwidthSettings.ts:22`, the `fetch()` comment at `providers/openai.ts:19`); strip `//` and `/* */` before matching. CI-verifiable
- **Contracts:** M1, M2, M4, and the eleven contracts named

### P13-2  P1's acceptance-lines clause is gated on the template file, and every PR since it landed ignores it

- **Severity:** HIGH, confirmed (orchestrator verified: `## Acceptance` absent from PR bodies 387, 388, 389, 390; 65a122fb dated 2026-08-28)
- **Site:** `AGENTS.md:29-34` (P1, "land through an issue-linked PR whose body quotes the issue's acceptance lines"); `.github/pull_request_template.md` (`## Acceptance`); `agents-contracts.test.ts:141` (`the PR template carries the Acceptance section the Spec review axis reads`)
- **What is wrong:** The only gate asserts that the template file contains the heading. It never reads a PR body. The clause and template landed in 65a122fb on 2026-08-28; PRs 387 through 390 merged 2026-08-29 and none carries `## Acceptance` (nor does any of the 15 most recent merged PRs). The Spec review axis that `claude-workflows.md` describes has nothing to read.
- **Why it matters:** This clause exists because of a recorded breakage that repeated (`claude-workflows.md`: "#375 then #377 eleven minutes later, #379 then #380 passed every gate while missing what the issue asked"). A rule added in response to two incidents, violated 4/4 times since, with a gate that measures a template file, is pure overhead: the reading cost is paid and the protection is zero.
- **Fix:** Pick one. (a) Enforce: a CI step in `ci.yml` on `pull_request` that fails unless `github.event.pull_request.body` contains `## Acceptance` followed by at least one non-comment line; the `native-version-guard` job (`ci.yml:15-40`) is the pattern for a check that exists to catch bypasses. Delete the template-file assertion at `agents-contracts.test.ts:141`, since the CI step subsumes it. (b) Retire: drop the acceptance clause from P1, the `## Acceptance` block from the template, the assertion, and the Spec-axis paragraph in `claude-workflows.md`, and let the Standards review carry it. Either is M3 work; (a) is what M1 demands and costs about twelve lines of YAML. Surviving gate: the CI step, or nothing.
- **Verification:** For (a), open a scratch PR with no Acceptance section and confirm the step fails; with one, passes. The step is a workflow, so `proven-red.mjs` does not apply; record the two run URLs in the PR.
- **Effort:** S (one workflow step plus one test deletion, or four deletions)
- **Risk:** (a) blocks the maintainer's own quick PRs until bodies carry the section; `github.event.pull_request.body` is empty on `push` events, so guard the step with `if: github.event_name == 'pull_request'`. CI-verifiable
- **Contracts:** P1, M1, M2

### P13-3  The proven-red job is not a required status check

- **Severity:** MED, confirmed (absorbs P9-1; orchestrator verified the six contexts)
- **Site:** branch protection on `main`; `ci.yml:184-213` (`proven-red` job, which also runs `npm run test:scripts` at `:205`)
- **What is wrong:** P2's only machine gate, and the only place `scripts/__tests__/*.test.mjs` runs, can be red and the PR still merges. `AGENTS.project.md` and `testing.md` both say CI runs it; neither says it does not block.
- **Why it matters:** M2: a gate whose exit code nothing consumes. `gh pr merge --auto`, the merge path the workflow playbook prescribes, merges the moment the six required checks pass.
- **Fix:** Add `proven-red` to the required contexts (`gh api -X PATCH repos/:owner/:repo/branches/main/protection/required_status_checks` with the seven contexts). No code. Then delete the "not yet in the required list" sentence at `docs/developer-guide/14-agent-development-model.rst:275`.
- **Verification:** Re-run the `gh api` query and quote the new contexts list in the PR body.
- **Effort:** S (one API call, one doc line)
- **Risk:** A flaky worktree run in `proven-red.mjs` would now block merges; the job has passed on every run inspected (six latest on main, three PRs). Confirm `scripts/proven-red.mjs` treats zero changed tests as a pass (its skip branches at `:49-54` do) before requiring it
- **Contracts:** P2, M2

### P13-4  A skip-type PR title bypasses proven-red even when source changed

- **Severity:** LOW, theoretical (no incident found; not counted)
- **Site:** `scripts/proven-red.mjs:49-52` (verified: the `SKIP_TYPES` title check at `:51` runs before the `source.length === 0` check at `:52`); `scripts/__tests__/proven-red.test.mjs:71` asserts `title: 'docs: x'` with source changes returns 0
- **What is wrong:** A PR titled `docs:`, `chore:`, `refactor:`, `ci:`, `build:`, `style:`, or `test:` that changes `app/src/**` skips the red proof. P5 has no gate of its own, so the title is unverified input that the P2 gate trusts.
- **Fix:** Reorder: if `source.length > 0` and the type is in `SKIP_TYPES`, run the proof (or fail with "title says <type> but source changed"). Update the assertion at `proven-red.test.mjs:71`.
- **Verification:** `npm run test:scripts` red on the flipped assertion before the change, green after.
- **Effort:** S (two lines, one test line)
- **Risk:** `refactor:` PRs with real source changes and no changed test will now fail with "a behavior change arrived with no changed test"; that is P2 as written, but expect one round of friction
- **Contracts:** P2, P5, M2

### P13-5  Facts stated in the instruction files are restated in playbooks

- **Severity:** LOW, confirmed
- **Site:** "Run npm/vitest from `app/`": `AGENTS.project.md:118`, `agents/project/testing.md:65-68`, `agents/project/llm-models.md:137-138`. Native build-number bumps: `AGENTS.project.md:124` and `agents/project/native.md:10`. Proven-red defined or re-explained: `agents/project/glossary.md:98-100`, `testing.md:14-17`, `agents/generic/claude-workflows.md:136-138` (a pre-gate lesson now mechanized by `proven-red.mjs`). P6 restated at `claude-workflows.md:73-76`; M2 restated at `claude-workflows.md:85-88` and again as a comment in `ci.yml:218-224`. Settings Never clause restated at `domain-context.md:205-207`.
- **What is wrong:** M4 says other docs link rule IDs and never copy text. Each copy is a second place to go stale; the `testing.md:65` copy already differs from `AGENTS.project.md:118` in what it warns about (jsdom config versus hooks).
- **Why it matters:** Reading cost with no added protection; a future edit to the rule leaves the copies behind.
- **Fix:** Delete the playbook copies and leave the ID where a pointer is useful; keep `testing.md:65-68` only for the jsdom symptom text the project rule lacks, or move that sentence into `AGENTS.project.md:118` (33 words free). `claude-workflows.md:136-138` goes entirely: the gate replaced the lesson. M3 protocol PR. Surviving gate: none needed (M4 stays review-only; the copies are few).
- **Verification:** word budget test and `quality-ratchet.test.ts` stay green.
- **Effort:** S (eight sites, all deletions)
- **Risk:** none to code
- **Contracts:** M4, M5

### P13-6  A domain-context entry describes a CI setup that no longer exists

- **Severity:** LOW, confirmed (absorbs P9-4; prior P9-4 open)
- **Site:** `agents/project/domain-context.md:266-270` (`## CI runners`: "runs under qemu and needs Node 18"); `.github/workflows/build-linux-arm64.yml:19,29` (`ubuntu-24.04-arm`, Node 22; verified)
- **What is wrong:** The entry is false and passes the hash gate because 76fb8c0d and 57015c35 exist. M2: the gate checks the citation, not the claim.
- **Why it matters:** The prior review recorded that this entry misled its own dispatch briefs. A false do-not-touch instruction costs a session every time it is obeyed.
- **Fix:** Delete the section. If the qemu constraint returns, the commit that reintroduces it adds the entry back with its hash.
- **Verification:** `agents-contracts.test.ts` hash test stays green (fewer hashes); `grep -rn qemu agents/ docs/` empty.
- **Effort:** S (one deletion)
- **Risk:** none
- **Contracts:** M2, M5

### P13-7  C2 and C5 are ungated, script-checkable, and have no recorded incident

- **Severity:** LOW, confirmed (absorbs P3-6, P4-4, P3-10, P4-5)
- **Site:** `AGENTS.md:60` (C2, "near 400 lines"); `AGENTS.md:65` (C5, "No one-file folders"). Counts today: 54 non-test files over 400 lines (52 at the prior review); one-file folders under `app/src`: `contexts/`, `assets/`
- **What is wrong:** M1 says a rule a script can check needs a gate. Neither has one, and `domain-context.md` records no breakage that file length or folder shape caused. Per this pillar's rule, a rule with no incident behind it is a deletion candidate, not a hardening candidate.
- **Why it matters:** C2 is read every session and violated by 54 files; contributors learn that the number is decorative, which weakens the rules beside it.
- **Fix:** C2: either add `max-lines` (400, `skipBlankLines`, `skipComments`) to `app/eslint.config.js` so `lint-ratchet.mjs` records its count in `.lint-baseline.json` and holds it (C7 machinery, zero new code; exempt `zmninja-ng-constants.ts` and `api/types.ts` by override since the Constants contract funnels values there by design), or drop the number from C2 and keep only the dead-code sentence. C5: drop the one-file-folder clause; two folders in the whole tree is not a pattern worth a rule; move `PipContext.tsx` and delete `react.svg` anyway as C2 dead-code cleanup. M3 PR either way. Surviving gate: `lint-ratchet.mjs` if C2 keeps its number.
- **Verification:** For the ratchet: `npm run lint:ratchet -- --update` once, then `npm run lint:ratchet` red on a scratch file pushed past 400 lines.
- **Effort:** S (one eslint rule plus one baseline update; or two sentence deletions)
- **Risk:** the ratchet adds one advisory-lint rule to the ~200-problem backlog; it cannot block anything until a file grows. CI-verifiable
- **Contracts:** C2, C5, C7, M1

### P13-8  The two ratchets enforce different tightness rules

- **Severity:** LOW, confirmed (verified both sites)
- **Site:** `app/src/tests/quality-ratchet.test.ts:43-49` (`baseline has not been raised without leaving room to shrink`, fails when baseline exceeds count by more than 5); `app/scripts/lint-ratchet.mjs:85-91` prints improvements and exits 0 with no equivalent check
- **What is wrong:** Same mechanism, two behaviors. A lint baseline raised by hand and never lowered back stays above reality indefinitely; the quality baseline cannot. C7 is enforced for one and advisory for the other.
- **Why it matters:** Low today (201 problems against a baseline that has held); it is an inconsistency a contributor learns twice.
- **Fix:** Port the five-line slack check into `lint-ratchet.mjs` after the regression loop (fail when any rule's `allowed - count > 5`), or delete it from `quality-ratchet.test.ts` for symmetry. The first keeps C7 honest.
- **Verification:** Bump a number in `.lint-baseline.json` by 10 on a scratch branch and confirm `npm run lint:ratchet` fails.
- **Effort:** S
- **Risk:** none to code; CI-verifiable
- **Contracts:** C7, M2

Path to 10/10.

Worth it, in order of breakage prevented per line changed: P13-3 (one API call; turns the pillar's best gate from advisory to blocking); P13-2 (gate PR bodies in CI or retire the clause; the incident it targets happened twice in one day); P13-1 (the grep assertions, all green today except two, and honest `Gate: review.` lines; ends eleven false gate claims); P13-6 and P13-5 (delete one false entry and eight duplicate paragraphs; pure reading-cost reduction); P13-7 (`max-lines` in the ratchet and drop the C5 clause); P13-4 and P13-8 (two small script fixes).

Not worth it: rewriting the ~37 source comments citing pre-restructure rule numbers (`out-of-scope.md:9-11` declines this, refs #285; P3-7 covers only the five gate files whose failure messages print the citation); splitting the 54 files over 400 lines; adding commitlint as a dependency for P5 (P13-4 closes the only place the title is load-bearing); putting `agents/**` under a word budget (playbooks load on demand by area, and `domain-context.md` earns its 2722 words with a hash per claim); merging `translation-keys.test.ts` into `agents-contracts.test.ts`; deleting `no-em-dash.test.ts` because no `AGENTS.md` rule backs it (`documentation.md` backs it and it is 58 lines); removing the pre-commit a11y, correctness, and tsc passes because CI repeats them (`.husky/pre-commit` and `lint-ratchet.mjs:24-27` record the deliberate split).

## Non-findings

Things that look wrong and must stay. Every do-not-retry from the domain playbook that touches reviewed code is listed here explicitly.

Dependency and module shape:

- `madge --circular` reporting 4 cycles (`stores/profile.ts` through `profile-bootstrap.ts`, `multiport.ts`, `ssl-trust.ts`, `notifications.ts`): each edge is an `await import()` break the Service boundary and Sessions contracts sanction, with the reason in a comment at each site.
- `api/store-gates.ts:11-12` statically importing `stores/auth` and `stores/settings`: the Sessions contract names it as the sole caller of `createApiClient`.
- `stores/profile.ts` and `stores/notifications.ts` statically importing services: the contract fixes direction as services-to-stores forbidden; stores-to-services is allowed.
- `ALL_PROFILES_ID` arms in `stores/notifications.ts:114` and `services/profile-initialization.ts:204-210`: the rehydrate migration and legacy arms the Aggregation contract permits.
- Static `@capacitor/core` imports (`lib/platform.ts:8`, `plugins/*/index.ts` `registerPlugin`): the Native contract's dynamic rule targets plugin packages; `@capacitor/core` is the runtime `Platform.isNative` needs.
- `new WebSocket(url)` in `services/notifications.ts:354`: not HTTP; owned by the Notifications contract.
- Five `console.*` calls in `lib/logger.ts` and `lib/log-file/capacitor.ts`: the logging module cannot log its own sink failure without recursing; `logger.ts:321` runs through `sanitizeLogMessage`.
- `lib/http/adapter-web.ts:108` calling `fetch` directly: the HTTP contract's own implementation.
- Access tokens in stream and image URLs (`lib/zm/url-builder.ts`, `api/events.ts`, `services/discovery.ts`): `img` and `video` cannot send headers; the contract text is the bug (P3-5), not the code.
- Unparented `getCurrentSession()` in `useMonitors`, `useGroups`, `useAlarmStates`, `useTimelineData`, `Events.tsx:137`, `LiveActivity.tsx:78`: all gated by `enabled: !!currentProfile?.id` or a caller-cleared flag; `useCurrentProfile.ts:54-59` returns `null` for an aggregate.
- `useScopedEvents.ts:203-210` and `useScopedMonitors.ts:74-84` always-enabled queries: they look like a missing auth gate; the inline comments (refs #337) record the gate as a failed approach. The docs that still describe the gate are the finding (P10-2, P10-6).
- `hooks/useScopedEvents.ts:256` fanning one shared page and limit to every profile, `hooks/useScopedTimelineEvents.ts:11` lacking live-mode injection, `useLiveActivityAllMode.ts:180` and `pages/LiveActivity.tsx:163` selectors rebuilding a Map: each carries a `ponytail:` comment naming the ceiling.
- `MontageErrorStrips` using a raw `"{name}: {message}"` join instead of a locale key: its comment records it as a deliberate mirror of Monitors; the fix is P2-1's shared component, not a locale key per page.
- Montage's single-mode error wall (`pages/Montage.tsx:507-516`) staying separate from the all-mode strips: the comment at `:500-506` explains one failed server must not hide healthy tiles.
- `useEventFilters.ts:249-253` near-unreachable guard: kept for symmetry, explained at the site.
- `Logs.tsx:110-111` picking a setter via ternary and `hover-preview.tsx:253-254`: arms differ; grep false positives.

Rendering, streaming, and layout (domain playbook do-not-retry entries):

- List virtualization of `EventListView` and Logs: failed twice (blank rows, stale text); do not re-attempt without a materially different approach.
- Responsive drag and resize montage editing on phone or tablet: built and reverted (90a7e1da); desktop-only by design.
- `react-grid-layout` `compactType: 'vertical'` and `preventCollision: false`: other values break resize handles (582b3a85, 1685ff90).
- Per-tile `IntersectionObserver`s or moving the observed element: `react-grid-layout` replaces a ref put on the tile element (c8d0d833); refs go one level in.
- The ref-callback cache in `useViewportGating` must outlive a detach (c8d0d833).
- `MonitorDetail` and `EventDetail` per-visit `useState` reset from effects rather than a route `key`: keying the route would remount the player and mint a fresh connkey on every step (4e447581, 200d805d, ec43a4dd).
- The scroll pad as a remembered per-profile setting: auto-measurement was wrong twice; do not re-attempt.
- Multipart MJPEG data-URL workaround only on WebKitGTK; Tauri blob-URL thumbnails likewise: do not extend to other platforms.
- Electron background and occlusion process switches for blank MJPEG: tried and reverted (69990402); stream-level reconnect on focus is the fix.
- Skipping HLS on Tauri for CORS: the failure is a dev-mode origin artifact (b4299c59).
- iOS video.js fullscreen via CSS overrides: native iOS fullscreen is the working approach (efda381a).
- Paint running on every `TimelineCanvas` render (`:256` comment): deliberate; only the bitmap reallocation is gated. Throttling per-frame viewport state: per-frame state is what makes panning feel direct.
- Compact and density-mode CSS overrides scoped to the compact container: global overrides bled into unrelated views three times.
- `touch-action` following the zoom level: needed for finger scroll from over the feed.

Native and platform:

- `NSAllowsArbitraryLoads`, `usesCleartextTraffic="true"`, `cleartext: true`, and `iosScheme`/`androidScheme: 'http'` in `capacitor.config.ts`: "Accepted risk for a self-hosted-NVR client" is written in the config.
- Android WebView `onReceivedSslError` calling `proceed()` with no pinned fingerprint, iOS `isCertTrustedForWebView` returning true with no pin, and trust being global once any profile enables self-signed: the Native contract's trust-on-first-use design and a recorded maintainer decision (all-profiles spec). Fail-closed without a stored fingerprint breaks self-signed onboarding.
- Electron trusting any cert when self-signed is on and `webSecurity: false` (`main.cjs:159,231-253`): documented in-file as not for a production desktop build without pinning.
- `ACCESS_LOCAL_NETWORK` absent while targeting SDK 36: declaring it ahead of the enforcing targetSdk broke every LAN server on Android 17 (#350); the gate is in `agents-contracts.test.ts`.
- `MainActivity` posting status-bar visibility and `WindowThemePlugin.reapply` to the decor view: Capacitor 8's `SystemBars` re-asserts on every configuration change; five fixes on one plugin before this was understood.
- `SafeAreaPlugin` and the `viewSafeAreaInsetsDidChange` debounce, and `main.tsx` recomputing safe-area insets: WKWebView stops updating `env()` after rotation; do not remove. No JS `orientationchange` handlers on iOS (d1112e17, 54af0cfe).
- WebLLM gated off on iOS: WKWebView's ~2GB jetsam limit kills model load.
- llama.cpp removed from the Android build (#270): do not reintroduce without a working Vulkan or NPU path and a measured win.
- `GeminiNanoPlugin.cancelChat` abandoning the call instead of cancelling: ML Kit's cancellation path throws `NoSuchMethodError` on its own thread pool and kills the process.
- `Generation.getClient()` unconfigured and `tools:overrideLibrary` for ML Kit: `ponytail:` comment and the `hasMlKit()` guard respectively.
- Static `SSLTrustPlugin.sslTrustEnabled` and `trustedFingerprints` in Swift: Foundation instantiates the `URLProtocol`; statics are the mechanism. `WindowThemePlugin.lastColor` being static: survives activity recreation by design; only its visibility qualifier is in P7-5.
- Non-hook `addListener` calls in services, `lib/safe-area-bootstrap.ts`, and providers: not React components, so `useCapacitorListener` does not apply; each removes its handle. `useAndroidBackButton.ts:108-125` handles the awaited-handle race the shared hook does not model.
- Native-model download helpers resolving with the plugin module namespace, not the `registerPlugin` proxy: the proxy intercepts `.then` as a native method call and the awaiter hangs.

Assistant:

- `getMonitorEventsSince` without Zod (`api/events.ts:311-314`): its own comment says a schema "would add a failure mode without adding a guarantee".
- `AssistantNativeSection.tsx:133-138` showing the native rejection message verbatim: OS-localized, mirrors the background-tasks drawer (refs #270).
- Time windows using copy-interpret-compute, never direct fills or app-side phrase regexes: deleted twice; measured why in `llm-models.md`.
- Regex "call a tool" nudges gated on locale; Hermes-style markup treated as a parse failure that retries: recorded code-path facts.

Tests and CI:

- `events.steps.ts:762-764` early return on `serverHasEvents()` and `monitor-zoom-pan.steps.ts` `serverHasTwoMonitors()` skip: API-derived, sanctioned by `testing.md`; the ec43a4dd body explains why the URL-derived guard was wrong.
- ec43a4dd shipping the EventDetail zoom reset with a unit test only and no e2e scenario: the commit records that the e2e passed with the fix disabled; a test that cannot fail is worse than none.
- `proven-red.mjs` skipping e2e-only ranges: documented at `scripts/proven-red.mjs:49-54`; `testing.md` gives the manual stash procedure.
- `.wip/` features counting as step references: `e2e-steps.test.ts:13-14` states this is deliberate staging.
- Two-state `content || empty` polls in step files (`timeline.steps.ts:119-123` and similar): the demo server may legitimately have no events; only the third generic term (P5-9) is the defect.
- Five events-filter scenarios failing against the demo server: bisect-proven pre-existing, tracked in #342; treat new failures against that baseline, not zero.
- `continue-on-error: true` on `npm run lint` in `ci.yml` and `|| echo` in `.husky/pre-commit`: deliberate, both comments cite #217; the ratchet step is hard.
- `e2e-tests` job green when secrets are absent in `ci.yml`: deliberate and now loud; the job comment cites M2.
- The pre-commit hook omitting `vitest run`: P3 asks for the full suite before push or PR, not per commit.
- `npm ci` repeated in six `ci.yml` jobs: jobs are independent required contexts and each caches on the lockfile.
- `cancel-in-progress` disabled on main; `npm install` at root required for hooks with the CI `native-version-guard` job existing precisely because that can be skipped.
- PTZ untestable on the CI ZoneMinder (`Controllable: 0` on every monitor): manual by design. `HoldButton` must stop the command on unmount.
- `test.yml` re-running unit tests on release: it exists for the coverage upload.
- Spinners freezing under reduced motion (`index.css:132-135`, refs #217); `-webkit-user-select: none` app-wide on native with editable fields exempted; keyboard shortcuts disabled in TV mode; `GridLayoutControls.tsx:191` visible icon staying 20px with a documented `::before` hit area; `CommandPalette.tsx:182` `outline-none` on the auto-focused sole field; toasts without explicit ARIA (sonner supplies its own live region); montage tile `focus:outline-none` paired with `focus-visible:ring-2`.

Instruction system:

- Test and script headers citing old rule numbers (`no-em-dash.test.ts:2`, `no-circular-deps.test.ts:2`, `e2e-steps.test.ts:2`, `dependency-classification.test.ts:2`, `check-native-version-bump.mjs:2`) and the ~37 source comments doing the same: `out-of-scope.md:9-11` rules the rewrite out (refs #285). P3-7 is scoped to the assertion messages a failing gate prints, which are user-facing output, and the executor should treat that scope as a judgment call for the maintainer.
- `AGENTS.project.md` Aggregation `Gate: review; mechanizing these is a tracked follow-up`: the honest form P13-1 asks the others to adopt.
- `claude-workflows.md:3` "Advisory, not binding": the generic playbook is meant to be prose; its duplicates (P13-5) are the finding, its length is not.
- `agents/project/domain-context.md` do-not-retry entries: each cites its reverting commit and none is touched by any fix proposed here.

## Phased execution plan

Ordered by risk reduced per unit of effort. Enforcement and cheap confirmed bugs first; large refactors of fragile working code last or deferred. Each item names its finding IDs. Device-only items are batched into one session at the end.

Phase 0, under an hour, no code: settings and text.

1. Make `proven-red` a required status check (P13-3, P9-1); delete the "not yet in the required list" sentence (`14-agent-development-model.rst:275`). Verify by re-running the `gh api` query.
2. Delete the false CI-runner entry in `domain-context.md` (P13-6, P9-4); delete the eight duplicate playbook paragraphs (P13-5); narrow the Auth tokens Never clause and add the access-token-in-URL line to `domain-context.md` (P3-5). One M3 protocol PR.
3. `git rm desktop_release_builds/tauri/.gitkeep` (P9-7); delete the dead root `.gitignore` Capacitor block (P9-9); remove root `@wdio/cli` and regenerate the root lockfile (P9-8).

Phase 1, gates first, against current behavior. Sequencing: every gate lands green against the code as it is (allowlist or baseline seeded with today's count), then the fixes shrink the allowlist. Landing a gate together with the work it would newly fail turns green CI red mid-PR.

4. The contract grep block in `agents-contracts.test.ts` (P13-1, P3-1): `console.`, `fetch`/`axios`, static Capacitor plugin imports, inline `queryKey`, services-to-stores static imports (transitive through `lib/`), `instanceof DOMException` outside the helper. Seed the last two with `download.ts:23` and the five DOMException sites allowlisted, then fix them (P3-2, P4-2, P11-4) and empty the allowlist in the same PR. Reword the seven remaining Gate lines to `Gate: review.` and point Localization at `translation-keys.test.ts`. Each assertion proven red with a scratch violation.
5. PR-body acceptance gate in `ci.yml` or retirement of the clause (P13-2). The maintainer chooses; the plan assumes enforcement. Delete `agents-contracts.test.ts:141` either way.
6. Doc-side forbidden-symbol test over `docs/developer-guide/*.rst` (P10-1, P10-5, P10-8), proven red, then the rewrites: 16 singleton sites, 7 `applySSLTrustSetting` sites, 1 `storeGates` site. Rewrite Flows 1, 2, and 5 onto the Flow 21 template (P10-2, P10-6); fix `checkAndRefreshAll` (P10-4); strip the 246 `#L` anchors with a no-anchor test (P10-3); add the developer-notices section to `settings.md` (P10-7).
7. Native-logging gate scanning `.swift` and `.java` (P7-2), proven red on `NotificationService.swift`, then the four-line fix (P7-1). Mark the PR device-pass-required for the rich-push check.
8. `waitForTimeout` allowlist in `e2e-steps.test.ts` (P5-4), seeded at 43; `max-lines` in `eslint.config.js` feeding the lint ratchet (P13-7, P3-6), baseline updated once; port the slack check into `lint-ratchet.mjs` (P13-8); reorder the `skipReason` checks in `proven-red.mjs` (P13-4); the two jsx-a11y rules (P8-5); a token-contrast vitest over `index.css` (P8-1), proven red on cream and destructive, then the token edits.

Phase 2, confirmed user-visible bugs, each S.

9. Then-assertion gate on reachability (P5-5), landed with the offending step files allowlisted; then P5-2 (one line), P5-1 (one file), P5-3, P5-6, P5-7, P5-8, P5-10, shrinking the allowlist to empty. Each e2e change proven red by the stash procedure; expect some scenarios to go red against the demo server per #342.
10. `ErrorBanner` `role="alert"` (P8-3); montage alarm reduced-motion tint and status text (P8-2); the collapsed sidebar "TV" literal (P8-7); the two 20px reorder buttons (P8-4).
11. `api/notifications.ts` schema (P11-1) and the direct-mode push status derived from outcome with a toast on the user path (P11-2); `withFieldCatch` on the three host-stat schemas (P11-3); the three hardcoded English fallbacks (P11-5, literals only).
12. Logs page onto `useQuery` with `ErrorBanner` (P1-5), with the profile-switch staleness test proven red.
13. Shared `ProfileErrorStrips` (P2-1) with the single-profile prefix unification and its red-first test; `eventPath`/`monitorPath` in `lib/navigation.ts` (P2-2); `formatElapsedShort` at the three duration sites (P2-5); `buttonVariants` destructive swaps including Logs (P2-6); `useBulkDeleteEvents` onto factory keys (P4-3).

Phase 3, performance, each with a render-count or spy test proven red.

14. `onPinToggle` through a `tileId` prop plus the two Map memos (P6-1, P6-5) in one commit; pinch scale written imperatively per frame (P6-2); `MontageMonitor` and the two settings bypasses onto the `useProfileById` template with a real-store regression test (P6-3, P3-4, P3-3).
15. Theme colours resolved once in `TimelineCanvas` (P6-4); pulse-state scan memoized (P6-7); scrubber visible-slice rendering keeping the `scrubber-density-*` testids (P6-6).

Phase 4, dependency and CI sweep.

16. `npm audit fix` in both dirs, bump `react-router-dom`, `electron`, `playwright-bdd`, one bump per commit; add `.github/dependabot.yml` with npm and github-actions ecosystems (P9-2); pin the third-party actions to SHAs and bump `action-gh-release` to v2 (P9-6); copy the loud-skip step into `test.yml` (P9-3); declare or replace `tsx` (P9-5). Run one feature e2e locally after the playwright-bdd bump.

Phase 5, clarity and reuse cleanups, behavior-preserving, on existing gates.

17. `.editorconfig` plus one whitespace-only reformat commit of the ~17 four-space files (P1-4); the `#00a8ff` constant (P1-8); TagChip dead ternary (P1-1); `HelpRow` hoisted (P1-2); the three remaining IIFEs (P1-11); the token-freshness helper at nine sites (P1-7); `animateToRange` side effect out of the updater (P1-6); the pointer comment in `useTimelineFilters` (P1-10); cause-badge extraction (P1-3); the PIN and QR boolean clusters onto discriminated unions (P1-9, AdvancedSection and QRScanner only); page-title stragglers (P2-4); `ListPageSkeleton` and the eleven `PageContainer` wrappers (P2-7); NotificationSettings empty state (P2-8); the `staleTime` constant (P3-9); timer literals or the contract exception (P3-8); gate-file rule-ID comments and the scan extension (P3-7); `PipContext.tsx` move and `react.svg` deletion (P3-10, P4-5); the probe-hook factory only if a fourth backend arrives (P2-3).

Phase 6, one device session, batched. Every item is device-pass-required and cannot be verified in CI.

18. iOS: prior P7-1 cert-fetch hang (resolve or reject in every closure branch plus a JS-side timeout); prior P7-4 stale comments; prior P7-5 dead `#available` arms and the triplicated leaf-cert extraction; the rich-push check from item 7. Android: prior P7-2 pin bypass (hostname verifier and the system-valid short-circuit; note the two-argument `checkServerTrusted` overload); prior P7-3 download guard; P7-3 media3 bump as a standalone `chore:` with a PiP smoke; P7-4 TV global deletion on a Fire Stick; the `volatile` and lock sites from prior P7-6. Also verify on device: P8-1 cream theme look, P8-2 alarm tint, P11-1 against a real notifications API, P11-2 push round-trip.

Deferred, maintainer's call: P4-6 (profile store durability on native; theoretical, M effort, async rehydration risk).

## Notes for the executing agent

Process:

- Create or use an issue before any code change (P1); the tracking issue for this review, if the maintainer opens one, is the umbrella. Commits reference it as `Refs #<n>`; closing keywords only after the maintainer confirms. Fold follow-on work into that issue; do not open new issues unasked.
- One logical change per conventional commit (P5). The dependency bumps in item 16 are one commit each. The reformat in item 17 is a standalone `chore:` with a `git diff -w` that is empty.
- Every new test is proven red against the pre-change code before the fix lands (P2). `scripts/proven-red.mjs <base> <head>` does this for unit tests; e2e scenarios use the stash procedure in `agents/project/testing.md`. A gate assertion is proven red with a scratch violation, then the scratch is removed in the same commit.
- Gates land green against current behavior with an allowlist or baseline seeded at today's count; the fixes shrink it. Never land a gate together with the work it would newly fail.
- Per commit: run the suites the change touches, plus any suite that consumes a changed settings shape, plus locale parity when a key is added. Before push or PR: `npm run gates` from `app/`, bare, exit code checked; never piped into a filter. Run `npx vitest` only from `app/`.
- Instruction-file edits (`AGENTS.md`, `AGENTS.project.md`, `agents/**`) go through the self-improvement protocol (M3): the PR that fixes the problem proposes the edit and the gate M1 requires. The word budget is 2100 with 33 words of headroom; every raise carries a reason comment in the test.
- GitHub comments end with `Posted by Claude, assisting @<login>.` where `<login>` comes from `gh api user --jq .login`. Commits carry no such line.
- Queue merges with `gh pr merge --auto` at PR creation; `allow_auto_merge` is true on this repo. Do not poll CI.

Native:

- Do not commit incidental native build-number bumps; `npm run android:sync` and `npm run ios:sync` bump them. Revert before commit. Intended bumps are standalone `chore:` commits. The commit-msg hook and the CI `native-version-guard` job enforce this.
- Every item in Phase 6 is device-pass-required; CI cannot verify it. State the device and OS version in the PR. Device e2e (Appium) is manual-only; never auto-run it.
- Never log a URL handed across the bridge, or a media or HTTP error object raw, in native code; the P7-2 gate will catch the patterns it knows, not all of them.

Do not:

- Merge the default branch into the working branch without approval (P8).
- Re-attempt anything in the Non-findings section. In particular: list virtualization, responsive montage editing, `react-grid-layout` option changes, JS `orientationchange` handlers on iOS, Electron occlusion switches, auto-measured scroll pad, per-profile native TLS trust, restoring Android llama.cpp, cancelling ML Kit calls, direct time-window fills in the assistant.
- Rewrite the ~37 inert source comments citing pre-restructure rule numbers (out-of-scope, refs #285). P3-7 covers only the gate files whose assertion messages print a citation; confirm that scope with the maintainer before touching them.
- Delete the empty `catch` in `tv-spatial-nav.ts` or any hook point that looks unimplemented; add the log (P8-6), do not remove the branch.
- "Fix" access tokens out of stream URLs (P3-5 is a contract-text change, not a code change), or remove the token from `img`/`video` sources.
- Split files to satisfy C2; ratchet the count and split opportunistically.
- Add dependencies for what a few lines do (no commitlint, no madge in the test suite, no axe-core in e2e).
