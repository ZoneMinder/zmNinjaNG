# All Profiles to virtual profile groups: a retrospective on the agent workflow

Written 2026-08-04 by the orchestrating agent, at the maintainer's
request; rewritten and extended 2026-08-05 after the maintainer asked for
substantially more depth and after two further programs ran under the
same process. It evaluates the agent framework this repository uses,
against a baseline of out-of-the-box Claude Code, using three consecutive
programs as the test case:

1. **All Profiles** (Aug 2-3): the original feature - one virtual "All
   Servers" mode aggregating every configured server.
2. **The hardening program** (Aug 4): nine tasks turning every All-mode
   surface fully functional - a crash fix, ~20 dead controls, filter
   persistence, palette/shortcut/tag fan-outs, a user-visible performance
   settings section, five connection optimizations, and a 20-item
   cleanup.
3. **Virtual profile groups** (Aug 4-5): the generalization - named
   groups of servers replace the single All Servers mode, which was then
   retired at the maintainer's direction, with a migration for existing
   users. Merged to main via
   [#338](https://github.com/ZoneMinder/zmNinjaNg/pull/338) and
   [#339](https://github.com/ZoneMinder/zmNinjaNg/pull/339) on Aug 5.

Sections 1-3 cover the first program in the depth the original report
had. Sections 4 and 5 are new: they walk the second and third programs
incident by incident, because that is where the process was tested
hardest - by then the easy defects were gone and what remained was
lifecycle and concurrency work, plus two agent deaths, a usage-limit
kill, and a shared-checkout race that all had to be recovered live. Out-of-the-box Claude Code can and does spawn subagents on
its own; what it lacks is everything this repository adds on top: written
rules and contracts, mandated independent review, mechanical gates, and a
recorded process. The comparison is discipline versus discretion, not
many agents versus one.

Context for readers outside this project. zmNinjaNg is a mobile and desktop
client for [ZoneMinder](https://zoneminder.com/), an open-source video
surveillance system. Users configure one "profile" per ZoneMinder server
(URL, credentials, TLS settings); a "monitor" is a camera, an "event" is a
recorded clip, and the Event Server (ES) is ZoneMinder's optional push
notification daemon. Until this work, the app could talk to exactly one
server at a time.

The task was to make that single-server client work against any number of
servers at once, everywhere: data, actions, streaming, notifications, and
TLS trust. Why this is a meaningful stress test of a development process,
in numbers: the change replaced the app's central API singleton (touched
by nearly every data path), modified three native layers (TypeScript, iOS
Swift, Android Java), and landed as 77 commits across 297 files
(+22,025 / -3,555 lines) in about 32 hours from first code commit to last
feature commit, executed by roughly forty agent contexts. The unit suite
grew from ~3,273 to 3,614 tests. Much of the code is
concurrency-sensitive (token refresh, websockets, staggered polling),
which is where plausible-looking changes fail in ways tests miss; a
process either catches those or it does not.

The framework under evaluation is checked into this repository:
[`AGENTS.md`](../../../AGENTS.md) (portable process and code rules with
stable IDs such as [P2](../../../AGENTS.md#process) or
[C7](../../../AGENTS.md#code); rule IDs throughout this report link to
their section), [`AGENTS.project.md`](../../../AGENTS.project.md)
(architecture contracts with named enforcement gates), the playbooks under
[`agents/`](../../../agents/) (per-domain working notes agents must read
before touching an area), and a subagent process: an orchestrating agent
writes per-task briefs, separate implementer agents build them test-first,
separate reviewer agents check each diff, and mechanical test gates block
commits that break declared invariants. None of that exists in baseline
Claude Code: there, whether a diff gets an independent review, whether a
fix gets a regression test, and whether an invariant survives a refactor
all depend on the model's judgment in the moment, with nothing written
down to hold it and nothing mechanical to stop a bad commit.

A note on method. This report is compiled from two sources: the git
history (now on main; both merges preserved every commit hash) and the
orchestrator's own session record of every dispatch, review, and fix
round. Where I cite a commit, the link is real and checked - every hash
in this report was verified with `git cat-file` before citing. Where I
quote a test failure or a probe result, it is quoted from the agent
report that produced it, not reconstructed. Where I make a judgment, I
say it is a judgment. Where I have no evidence one way or the other, I
say that.

All commit links are to `github.com/ZoneMinder/zmNinjaNg`.

## Verdict by pillar

Details and evidence follow in sections 3-6; this table is the summary.
"Helped" means it produced outcomes out-of-the-box Claude Code would
probably have missed, with incidents to show for it. Counts cover all
three programs.

| Pillar | What it adds over standard Claude | Verdict |
|---|---|---|
| Independent review loop (separate reviewer per task, re-review per fix round) | A second context re-derives correctness instead of the author grading their own work | Helped; largest single effect: 10 user-visible defects in program 1 (3.1), and every High/Critical of programs 2-3 - the unwritable streaming mode, the connkey leak, the wrong-port quit, the cold-mount mint/quit, the ownerless socket, the keyboard trap (4, 5) |
| Mechanical gates (contract tests, lint ratchet, instruction word budget, locale parity) | Invariants enforced by failing tests, not by memory or goodwill | Helped; blocked real drift repeatedly, including against the orchestrator twice, and one gate caught a live rules-of-hooks bug mid-wave (3.2, 3.7, 4.3, 4.9) |
| Architecture contracts in [AGENTS.project.md](../../../AGENTS.project.md) | Written invariants quoted in every brief and review | Helped; mostly by prevention, visible as absence of whole defect classes; the composite-id contract written after program 1 was load-bearing in programs 2-3 (3.3, 4.2) |
| Test-first with proven-red regression tests ([P2](../../../AGENTS.md#process)) | A fix's test must be shown failing on pre-fix code | Helped; caught 2 vacuous tests in program 1 and kept catching them (a defect-encoding assertion, a mock that could not fail, a pin on an absent element) in 2-3 (3.4, 4.4, 5.4) |
| Mutation verification (reviewers re-apply defects and demand the test fail) | Proves tests discriminate rather than decorate | Helped; grew from an occasional check into the standard reviewer move - batteries of 5-11 mutants per wave, and the survivors were findings themselves (4.7, 5.2) |
| Raw-output rule ([P6](../../../AGENTS.md#process)) | Verification reads raw command output, never summaries | Helped; decisive twice in program 1, twice more later (a wrapper hiding vitest output, an npx-from-wrong-directory failure mistaken for a regression) (3.5, 6.2) |
| Ledger, committed plans, audit-first recovery | Progress state survives crashes and restarts | Helped; five failures recovered across the arc: reboot, network drop, LAN outage, a usage-limit kill, an API-drop kill - the last two mid-task with uncommitted work (3.6, 4.4, 5.5) |
| Playbooks and domain knowledge (M5 pipeline) | Per-domain facts agents read before working | Now proven both directions: facts recorded during the arc (seeding trap, fixture spreading, npx trap) were consumed by later waves and visibly prevented repeats (3.8, 5.1) |
| Brief-driven dispatch | Orchestrator writes the task, implementer builds exactly that | Mixed; propagates orchestrator mistakes with full test coverage, and briefs' line numbers rot within hours on an active branch (6.1) |
| Multi-agent messaging and lifecycle | Parallelism across ~90 agent contexts over four days | Keep; the losses (report delivery, idle noise, shared-checkout races, unrecoverable kills) are harness defects to fix, not a reason to use fewer agents (6.2) |
| Live-server e2e testing | End-to-end checks against a real ZoneMinder | Keep; it found what unit tests structurally could not - the seeding trap, a react-grid-layout ref bug, a viewport-gating no-op - and the flakiness stayed attributable to shared infrastructure every time it was checked (4.3, 5.3, 6.3) |

---

## 1. What was built and why it matters technically

The All Profiles feature adds a virtual "All Servers" profile that shows
every configured ZoneMinder server together in one UI. Every major surface
aggregates: the camera list (Monitors), recorded clips (Events), the
Timeline, the multi-camera grid (Montage), the Dashboard, the live alarm
board (Live Activity), and push notifications. Any action, such as playing
a clip or arming a camera, routes automatically to the server that owns it.
The spec behind all of it is
[the all-profiles design](../specs/2026-08-02-all-profiles-design.md).

The feature sounds additive; technically it was a rework of the app's
central assumption. The codebase was built around exactly one active
server: one global API client, one access token, one server timezone, one
trusted TLS certificate, one notification socket. Two refactors had to
land before any UI:

- The global API-client singleton was deleted and replaced by a session
  registry: one `ServerSession` (client, auth-token slice, timezone) per
  profile, created lazily and cached. The auth store went from one token
  set to per-profile slices with per-profile single-flight refresh, so two
  servers refreshing tokens concurrently cannot interleave.
- Native TLS trust went from one stored certificate fingerprint to a
  host-keyed fingerprint map in all three native layers (iOS Swift,
  Android Java, and the web/Electron layer), so several self-signed
  servers can be trusted at once.

The consequences that outlast the feature:

- **Single-server mode is no longer a separate code path.** A single
  profile is now the one-element case of the same aggregation code
  (`useProfileScope` returns a one-profile array in single mode). There is
  no "all mode" fork to keep in sync with the normal path.
- **Identity is now composite.** ZoneMinder ids (monitor 5, event 1234)
  collide across servers, so every aggregate data structure keys on
  profile-plus-id composites. Six defects during the project came from
  forgetting this; the helper and contract that resulted are now the
  standard for any future multi-server surface.
- **Partial failure is a first-class state.** One unreachable server
  degrades to an inline error strip while the other servers' data still
  renders, on every aggregated page, instead of one failure blanking the
  app.
- **Notifications are per-connection, not global.** Each enabled profile
  holds its own ES socket or polling fallback, with events attributed to
  their profile at the socket boundary, plus burst coalescing so five
  servers alarming at once produce one grouped notification.
- **Load scales deliberately.** Polling across N servers is staggered
  rather than synchronized, Live Activity caps concurrent streams with
  round-robin rotation, and the resource-heavy mode is opt-in with a
  warning on the profile card.

The work shipped as two stacked PRs:

- [**#338**](https://github.com/ZoneMinder/zmNinjaNg/pull/338)
  (`feat/all-profiles-sessions`): TLS multi-fingerprint plus the
  session-layer migration. 27 commits.
- [**#339**](https://github.com/ZoneMinder/zmNinjaNg/pull/339)
  (`feat/all-profiles-ui`): the visible feature, phases 2 through 4,
  plus about a dozen post-completion increments that came from the
  maintainer's live acceptance testing. 50 commits.

Beyond the size figures in the introduction, the lint ratchet baseline
ended lower than it started (react-hooks/exhaustive-deps went from 38 at
the branch point to 34 at close). First code commit
[`af8c8a2`](https://github.com/ZoneMinder/zmNinjaNg/commit/af8c8a20) landed
2026-08-02 at 14:15; the last feature commit
[`1c8fd61`](https://github.com/ZoneMinder/zmNinjaNg/commit/1c8fd614) landed
2026-08-03 at 22:13. In between there was a maintainer sleep window, a host
reboot, a network outage, and a move to a different LAN.

### Timeline

| Stage | Landed | Anchor commits |
|---|---|---|
| Spec + phase 0/1 plan | Aug 2, morning | [`36317b8`](https://github.com/ZoneMinder/zmNinjaNg/commit/36317b8), [`e21e609`](https://github.com/ZoneMinder/zmNinjaNg/commit/e21e609) |
| Phase 0: TLS host-map (JS, iOS, Android) | Aug 2, ~14:15-15:00 | [`af8c8a2`](https://github.com/ZoneMinder/zmNinjaNg/commit/af8c8a20), [`18bb83d`](https://github.com/ZoneMinder/zmNinjaNg/commit/18bb83d7), [`3848380`](https://github.com/ZoneMinder/zmNinjaNg/commit/3848380e) |
| Phase 1: session layer, singleton deleted | Aug 2, afternoon-evening | [`f1ab768`](https://github.com/ZoneMinder/zmNinjaNg/commit/f1ab7685), [`a38b2ac`](https://github.com/ZoneMinder/zmNinjaNg/commit/a38b2aca), [`73b9959`](https://github.com/ZoneMinder/zmNinjaNg/commit/73b99594), [`93bb7de`](https://github.com/ZoneMinder/zmNinjaNg/commit/93bb7deb) |
| Phase 2: All mode + aggregated Monitors | Aug 2 night - Aug 3 early | [`6bc4b50`](https://github.com/ZoneMinder/zmNinjaNg/commit/6bc4b50e), [`4cc8ae6`](https://github.com/ZoneMinder/zmNinjaNg/commit/4cc8ae68), [`a1b1657`](https://github.com/ZoneMinder/zmNinjaNg/commit/a1b16579), [`da38666`](https://github.com/ZoneMinder/zmNinjaNg/commit/da38666a) |
| Phase 3: Events/Timeline, deep routes, notification taps | Aug 3, morning-midday | [`7009839`](https://github.com/ZoneMinder/zmNinjaNg/commit/70098391), [`11ff9ce`](https://github.com/ZoneMinder/zmNinjaNg/commit/11ff9ce4), [`a3abfe4`](https://github.com/ZoneMinder/zmNinjaNg/commit/a3abfe48), [`5a8cf65`](https://github.com/ZoneMinder/zmNinjaNg/commit/5a8cf654) |
| Phase 4: Montage, Dashboard, pickers, assistant | Aug 3, midday-afternoon | [`bc25cec`](https://github.com/ZoneMinder/zmNinjaNg/commit/bc25cec1), [`89b3c4e`](https://github.com/ZoneMinder/zmNinjaNg/commit/89b3c4ef), [`edbe1c3`](https://github.com/ZoneMinder/zmNinjaNg/commit/edbe1c3e), [`85ffc08`](https://github.com/ZoneMinder/zmNinjaNg/commit/85ffc086) |
| Acceptance-testing increments | Aug 3, evening-night | [`db96140`](https://github.com/ZoneMinder/zmNinjaNg/commit/db961404), [`3d7f4cc`](https://github.com/ZoneMinder/zmNinjaNg/commit/3d7f4ccc), [`74c65f0`](https://github.com/ZoneMinder/zmNinjaNg/commit/74c65f00), [`542c814`](https://github.com/ZoneMinder/zmNinjaNg/commit/542c814d) |
| Closeout: docs, contracts, this report | Aug 3 night - Aug 4 | [`c83bebe`](https://github.com/ZoneMinder/zmNinjaNg/commit/c83bebea), [`069cada`](https://github.com/ZoneMinder/zmNinjaNg/commit/069cada) |

---

## 2. How the work was organized

The design phase used the brainstorming skill interactively: about ten
clarifying decisions (scope, UX model, preference handling, write behavior,
architecture approach), each answered by the maintainer, then
[a spec](../specs/2026-08-02-all-profiles-design.md) committed before any
code. The maintainer explicitly chose a big-bang migration of the API
layer over an incremental facade, and that decision is recorded in the
spec as final.

Each phase then followed the same loop:

1. A written plan with per-task briefs, committed to the repo.
2. One fresh subagent per task to implement, working test-first.
3. A different subagent to review that task against the brief and the
   project contracts.
4. If the review found problems, the same implementer fixed them, and a
   scoped re-review verified only those fixes.
5. After all tasks, a whole-branch review on the most capable model,
   followed by one consolidated fix wave and a re-review of that wave.

Progress lived in a ledger file per phase so that a crash or restart could
not lose the thread. Roughly forty subagents ran over the two days. Nothing
merged without review except two one-line cosmetic edits made directly by
the orchestrator (a button variant in
[`6cac031`](https://github.com/ZoneMinder/zmNinjaNg/commit/6cac031a) and a
card color in
[`b090a6c`](https://github.com/ZoneMinder/zmNinjaNg/commit/b090a6c1)), both
covered by existing tests.

---

## 3. Where the rules and contracts helped

For each mechanism I describe what it is, the specific incidents where it
mattered, and what I believe would have happened without it. Every incident
cites the commit that fixed it.

### 3.1 The independent review loop

This mechanism caught more defects than everything else combined. The
recurring pattern: an implementer produces plausible,
green-tested code; an independent reviewer, reading the diff against the
brief and the contracts, finds a defect the implementer's own tests could
not see. Ten of those defects would have been user-visible breakage.
The list, in order:

1. **Pre-save TLS trust regression** (phase 0). My own brief told the
   implementer to compute the trust union from saved profiles only. The
   reviewer noticed that the profile-creation flow tests the connection
   *before* the profile is saved, so the very first self-signed profile
   could never onboard. The maintainer ruled the fix: a candidate override
   for the in-flight profile,
   [`67b30f2`](https://github.com/ZoneMinder/zmNinjaNg/commit/67b30f29).
   Worth noting: the implementer had flagged the risk in its own report,
   but it was the review that turned the flag into a blocking finding.
2. **Proactive token refresh silently dead** (phase 1). The new session
   guard depended on wiring that would not exist until two tasks later, so
   token refresh would never fire and live streams would go blank after
   about 90 minutes. Found by the task review of the auth-store refactor;
   fixed in [`94bc5a8`](https://github.com/ZoneMinder/zmNinjaNg/commit/94bc5a8b)
   along with four other findings from the same review (orphaned tokens
   from unsaved profiles, tokens surviving profile deletion, a single-flight
   race on failed refresh, and a reserved marker id being used as a
   scratch bucket).
3. **Cross-profile host/token bleed** (phase 2 whole-branch review). The
   server map for multi-server ZoneMinder installs was a single global,
   populated by whichever profile bootstrapped last, so profile B's access
   token could be attached to a request aimed at profile A's host. Made
   per-profile in
   [`ac55a05`](https://github.com/ZoneMinder/zmNinjaNg/commit/ac55a056).
4. **All mode silently omitting profiles** (phase 2 whole-branch review,
   the one Critical of that phase). Any profile not bootstrapped in the
   current app session had its queries disabled forever: no data and,
   worse, no error strip, so the aggregate count was just quietly wrong.
   After an app restart in All mode, the page showed a skeleton forever.
   Fixed in [`22a7285`](https://github.com/ZoneMinder/zmNinjaNg/commit/22a7285c).
   This was the exact failure mode the partial-failure design existed to
   prevent, and no unit test could see it because the test mocks bypassed
   the real enablement path.
5. **Blank live player on the deep route** (phase 3 whole-branch review,
   Critical). `/all/monitors/:profileId/:monitorId` was the headline
   destination of the phase, and its live video (MJPEG stream) player
   rendered blank because
   one `profileId` prop was missing. The e2e test asserted only the URL,
   so it passed. One line, fixed in
   [`d0422f8`](https://github.com/ZoneMinder/zmNinjaNg/commit/d0422f86).
6. **Two defects introduced by a fix wave itself** (phase 3). The
   composite-key fix leaked composite tokens into the event prev/next
   navigation (breaking it in All mode), and removing a persisted write
   broke the `?view=montage` deep link for ordinary single-profile users.
   Both were caught by the scoped re-review of the wave that created them,
   and fixed in
   [`2de8a7d`](https://github.com/ZoneMinder/zmNinjaNg/commit/2de8a7d1).
7. **A render loop that crashed the notification history page** the moment
   one notification existed, in both modes (post-completion, Critical).
   The selector built new objects on every call, which the shallow
   comparison in zustand (the app's state library) can never stabilize. The page's own test could not fail on
   this because it mocked the store as a plain function, skipping
   `useSyncExternalStore` entirely. The reviewer reproduced the crash
   against the real store; fixed in
   [`36587c5`](https://github.com/ZoneMinder/zmNinjaNg/commit/36587c5b),
   with a real-store regression test.
8. **Three consecutive defects in the multi-connection notification work**,
   each created by the previous round's fix: a socket leak on ordinary
   profile switches
   ([`9112a69`](https://github.com/ZoneMinder/zmNinjaNg/commit/9112a694)),
   then an auto-connect deadlock after routine bootstrap writes
   ([`e98c77d`](https://github.com/ZoneMinder/zmNinjaNg/commit/e98c77d6)),
   then a per-drop reconnect that defeated the exponential backoff and
   doubled sockets
   ([`7008691`](https://github.com/ZoneMinder/zmNinjaNg/commit/70086912)).
   Each was found only because every fix round got its own scoped
   re-review. Each fix was tested and green, and each was wrong; without
   per-round re-reviews all three defects would have shipped.
9. **The Live Activity watch-cap evicting an on-screen alarming tile**
   with no dwell window (the tile-churn class issue
   [#313](https://github.com/ZoneMinder/zmNinjaNg/issues/313) exists to
   prevent, reachable through a new code path). Found by a task-level
   review; fixed with a resident-exemption in
   [`c468a66`](https://github.com/ZoneMinder/zmNinjaNg/commit/c468a66b).
10. **A wrong-profile settings write in plain single mode** on the very
    last increment: the Live Activity settings dialog captured the profile
    id once at mount, and the page never unmounts, so after any profile
    switch the ignore list silently edited the previous profile's
    preferences. Fixed in
    [`1c8fd61`](https://github.com/ZoneMinder/zmNinjaNg/commit/1c8fd614).

Two more observations about the review loop that the list above does not
capture:

- Reviewers frequently verified claims instead of trusting reports. The
  phase 2 reviewer read TanStack Query's installed source to prove the
  render-instability finding. The multi-connection reviewer read the
  installed zustand shallow-compare implementation. The phase 3 T7 reviewer
  bisected the branch to prove five e2e failures pre-dated our work. This
  is behavior the reviewer prompt asks for ("verify, don't trust"), and it
  repeatedly changed outcomes.
- The loop also applied to the orchestrator's own commits. The final
  review of my closeout commit found
  a rule violation I had just written (a contract Gate line claiming
  enforcement the gate does not perform) and two factual errors in the
  first draft of this very report (wrong ratchet figures, and a
  review-tier misattribution that flattered my own argument). Corrected in
  [`32f7c03`](https://github.com/ZoneMinder/zmNinjaNg/commit/32f7c03) and
  [`069cada`](https://github.com/ZoneMinder/zmNinjaNg/commit/069cada).
  Without that review, this report would contain two wrong numbers and a
  claim that overstated my own case.

### 3.2 The lint ratchet (rule [C7](../../../AGENTS.md#code))

C7 says the lint baseline may shrink or hold but never grow, and that a
hand-raise needs a written reason. It was tested twice. The two incidents
ended differently, and the difference tracks the evidence in each case,
which is what the escape hatch is for.

- In phase 4, an implementer raised the `react-hooks/static-components`
  baseline from 9 to 10 with the justification "five existing call sites
  use this pattern." The reviewer rejected that reasoning by name (it is
  the precise rationalization the rule exists to block) and proposed a
  rewrite. The implementer then tried the rewrite and reported honestly
  that it did not clear the diagnostic; the reviewer re-verified that
  negative result empirically, retracted, and the +1 stood as a documented
  hand-raise in
  [`6d409ff`](https://github.com/ZoneMinder/zmNinjaNg/commit/6d409ffe).
- Earlier in the same phase, a different +1 (exhaustive-deps, from a fake
  dependency used to bust memoization) was challenged the same way, and
  this time the clean alternative existed: subscribing at the tile level
  instead of faking a dependency at the parent. The fix in
  [`ac1310f`](https://github.com/ZoneMinder/zmNinjaNg/commit/ac1310f7)
  removed the new violation *and* the pre-existing copy of the same hack,
  ending below the original baseline.

The ratchet also went down for legitimate reasons twice more
([`e4986c9`](https://github.com/ZoneMinder/zmNinjaNg/commit/e4986c9f),
[`0583bf3`](https://github.com/ZoneMinder/zmNinjaNg/commit/0583bf3c)). Net
effect across 22,000 added lines: the debt number fell. My judgment is
that without the rule it would have grown, because both blocked increments
came with plausible-sounding justifications.

### 3.3 The architecture contracts in [AGENTS.project.md](../../../AGENTS.project.md)

The contracts were quoted in every task brief, and the pattern of failures
shows they worked mostly by *prevention*, which is hard to prove but shows
up as absence: across roughly forty implementer runs there were no direct
`fetch`/`axios` calls, no inline query keys, no console logging, no
hardcoded user-facing strings that reached a reviewer. Every locale change
landed in all five languages in the same commit, gate-enforced.

Three contracts had specific, checkable effects:

- **[Settings.](../../../AGENTS.project.md#settings)** The rule that every coercion lives in
  `mergeProfileSettings` meant the ALL-bucket design needed zero new
  storage code, and the
  live/muted/off migration
  ([`74c65f0`](https://github.com/ZoneMinder/zmNinjaNg/commit/74c65f00))
  had exactly one correct place to put its legacy-boolean conversion.
  Reviewers checked bucket writes on both sides (target written, other
  bucket untouched) because the contract told them which side was which.
- **[Sessions.](../../../AGENTS.project.md#sessions)** Written mid-project (phase 1,
  [`93bb7de`](https://github.com/ZoneMinder/zmNinjaNg/commit/93bb7deb))
  with real grep-gates: ApiClient construction confined to four sanctioned
  files, the deleted singleton stays deleted, the reserved marker ids
  (such as the All-Servers id) live only
  beside their brand. Those gates then ran green through 50 more commits
  and caught one real drift attempt: an implementer's test files used raw
  `'__all_profiles__'` string literals, and the gate blocked the commit
  until they imported the constant.
- **[Auth tokens.](../../../AGENTS.project.md#auth-tokens)** The single-flight dedup contract shaped the phase 1
  refactor (per-profile gates had to preserve it, and the tests that
  encode it were named as the gate in the brief), and it is why the
  reviewer of the multi-connection work could state precisely which
  regression mattered when a hook started racing the service's backoff.

The two-tier preference rule from the spec (data preferences come from
each profile's own bucket, view preferences from the ALL bucket) was
applied without ambiguity to something like fifteen later decisions:
excluded monitors,
event filters, ignore lists, grid layouts, mute settings, screen memory.
Nobody ever had to ask "where does this setting live," which was the
maintainer's original "no confusion later" requirement.

### 3.4 Test-first with proven-red regression tests (rule [P2](../../../AGENTS.md#process))

The plain test-first habit is hard to audit from the outside, so I will
only claim what I saw evidence for: the *proven-red* discipline, where a
fix's regression test must be shown to fail against the pre-fix code,
caught two tests that would otherwise have been decorative.

- The reference-stability test for the aggregation hook initially used a
  same-data refetch, which passed against both the broken and fixed
  implementations because React Query's own render suppression masked the
  difference. The implementer discovered this by running it against the
  stashed old code, and replaced it with a rerender-based test that
  genuinely discriminates
  ([`a1b1657`](https://github.com/ZoneMinder/zmNinjaNg/commit/a1b16579)).
- The notification render-loop fix demanded a test against the real store,
  because the existing mock structurally could not fail. The implementer
  proved the new test red first, and that test style
  (`*.realstore.test.tsx`) then became the required pattern for the whole
  bug class, and caught the next instance during the overview feature
  ([`9f25d2e`](https://github.com/ZoneMinder/zmNinjaNg/commit/9f25d2e5)).

### 3.5 Raw-output distrust (rule [P6](../../../AGENTS.md#process) and the rtk memory)

Twice decisive. A compressed test summary reported "0 failed" while a
suite-level import error was hiding underneath it; the implementer of
phase 4 task 6 caught it only by reading the raw JSON reporter output.
And the locale sed accident (a bulk regex that broke 15 pluralized strings
across all five languages) was caught the same way, by reading the actual
failure text of two seemingly unrelated tests rather than trusting the
green/red count. Both times the project's standing instruction to distrust
summarizing wrappers was the difference.

### 3.6 The ledger and recovery from real-world failures

Three environment failures hit during the work:

- A host reboot killed an implementer mid-task with about twenty modified
  files uncommitted. A fresh agent was dispatched with instructions to
  audit the orphaned work rather than trust it; it found the work largely
  complete, fixed a latent test bug the original had left, and landed it
  ([`7009839`](https://github.com/ZoneMinder/zmNinjaNg/commit/70098391)).
- A network drop killed another agent the same way; same recovery pattern,
  same result ([`a3abfe4`](https://github.com/ZoneMinder/zmNinjaNg/commit/a3abfe48)).
- The machine moved to a LAN that could not reach the test ZoneMinder
  server, stranding e2e acceptance. The response: commit locally, hold the
  push, write the exact resume commands into the report, and poll for the
  network in the background. When the maintainer restored the LAN,
  acceptance ran and the queue drained with nothing lost.

The ledger file (per-phase progress notes with commit ranges and rulings)
is what made these recoveries cheap. After the reboot, the resumed session
knew exactly which tasks were complete, which fix round was open, and what
had been ruled on, without re-reading the whole history.

### 3.7 The instruction word-budget gate (the [M-series rules](../../../AGENTS.md#meta-governs-this-file))

A minor incident, recorded because it constrained the orchestrator.
The `agents-contracts` test caps the combined instruction files at 2,000
words. My closeout added three contracts and blew the budget twice; the
gate forced roughly forty words of compression before the additions could
land ([`069cada`](https://github.com/ZoneMinder/zmNinjaNg/commit/069cada)).
The instruction files ended at exactly 2,000 words. The rule exists so
the always-loaded context cannot silently grow, and here it constrained
the person adding rules, not just implementers.

### 3.8 Domain-specific knowledge: what helped and what did not

This splits into two parts. The playbooks that existed *before* this work
helped in narrow, checkable ways:

- [`agents/project/testing.md`](../../../agents/project/testing.md) is why the e2e strategy was realistic from
  the start: it documents that automated e2e is Chromium-only against one
  real server, which shaped the "two profiles on the same server plus one
  unreachable profile" test design instead of an unworkable mock-server
  plan.
- [`agents/project/documentation.md`](../../../agents/project/documentation.md) produced measurably consistent docs:
  reviewers verified call-flow structure (step counts, symbol citations,
  no line numbers) against the playbook's own rules, and the doc gates
  (heading voice, citation format, no em-dashes) failed builds when
  violated rather than relying on taste.
- [`agents/project/native.md`](../../../agents/project/native.md) mostly pointed to the [Native contract](../../../AGENTS.project.md#native), which
  carried the TLS trust-on-first-use invariant that drove the phase 0
  review finding.

The domain facts *added during* this work (the alarm endpoint being
single-monitor only, cross-server id collisions, ES payload profile
fields, the i18next `{{count}}` reservation, the live-server e2e
degradation pattern) were written into
[`agents/project/domain-context.md`](../../../agents/project/domain-context.md)
at closeout. They did not help this project, because they were learned
here; they can only help future work. I want to be clear about that
distinction: writing them down is following rule
[M5](../../../AGENTS.md#meta-governs-this-file), but at the time of the
original report I had no evidence the M5 pipeline pays off, only that
this run *consumed* facts recorded by earlier runs.

**Postscript, Aug 5: the pipeline is now proven in both directions.**
The seeding trap documented at the end of program 2 (section 4.3)
directly shaped a program-3 design decision within a day - independent
settings buckets instead of inheritance, chosen BECAUSE the recorded
trap says absence-as-state cannot work (section 5.1). The
fixture-spreading trap recorded after the four-commit P3 breach
(section 4.6) was cited in every subsequent brief and the breach class
did not recur. And the npx trap entry converted a third would-be
incident into a seconds-long recognition (section 6.2). Recording facts
where the next agent must read them is no longer a bet; it has receipts.

One domain rule was discovered too late to be cheap: composite ids.
Monitor and event ids collide across servers as a matter of course, and
six separate defects came from bare-id keys in aggregate code (the
timeline row merge, the popover profile resolution, the filter
cross-selection, the connection keys, the go2rtc cache, the hint
matching). The spec named the risk in prose; nothing enforced it. After
the third incident the `monitorCacheKey` helper became the standard, and
the closeout added an
[Aggregation contract](../../../AGENTS.project.md#aggregation-all-servers-mode),
but a gate that could check it
mechanically does not exist yet and is the top tracked follow-up. Had the
composite-id rule existed before phase 2, most of the six incidents would
not have happened; this is the clearest case in the project where a
missing rule had a measurable cost.

---

## 4. The hardening program (Aug 4): nine waves, incident by incident

The maintainer opened the day with three lines: label the montage
monitor list by server, explain two greyed buttons, and propose
connection optimizations. Two directives turned that into a program:
"nothing in All mode should be disabled due to currentProfile - we
already have an All-profile bucket," and "make it easy for users to view
what all is different (and change them if needed)." A read-only audit
agent swept every All-mode surface and produced the work list; nine
tasks ran through the same implement/review/fix/re-review loop as
program 1. This section walks the waves in order, at the depth the
incidents deserve, because several of them are the best evidence in this
report.

### 4.1 The audit, and what "greyed buttons" actually was

The audit (its first downstream fix landed as
[`7374f94`](https://github.com/ZoneMinder/zmNinjaNg/commit/7374f949))
found the two greyed buttons were the visible tip of ~20 controls that
were disabled, or worse, silently inert in All mode: feed-fit wrote to
nothing, saved layouts saved nothing, the insomnia toggle rendered the
wrong state AND did nothing, kiosk unlock left insomnia stuck on, every
keyboard shortcut was dead, and the command palette silently listed no
monitors. It also found one latent crash: bulk event delete in All mode
called `getCurrentSession()` on the aggregate sentinel, which throws,
inside a try/finally with no catch - an invisible failure on a
destructive path, reachable from every All-mode event card.

The audit's classification (view-level vs data-level per control) is
what made the fixes mechanical: view-level controls got the established
sentinel-bucket write target; data-level surfaces (palette monitors,
tags) got scoped fan-outs; and one item (cross-server group filtering)
was explicitly parked rather than improvised. Program 1 had ended with a
finding that its own audit-then-wave discipline was its best tool; this
day was that discipline applied from hour one.

### 4.2 Bulk delete: the composite-id contract catches its first crash

The fix ([`c732a9c`](https://github.com/ZoneMinder/zmNinjaNg/commit/c732a9ce))
is the clearest demonstration that program 1's closeout contract work
paid off. The selection store held bare event ids; the Aggregation
contract written two days earlier says bare ids may never key aggregate
state, because event 1234 exists on both servers. The implementer's
proof-of-red was the production crash itself: with `getCurrentSession`
mocked to throw exactly as it does in All mode, all four All-mode tests
failed with `getSession: ALL_PROFILES_ID has no session` while all four
single-mode tests stayed green - the correct shape for a no-regression
suite. The redesign routed each delete to its owning profile's session,
made selection keys composite, kept partial failures queued for retry,
and - beyond the brief - fixed the same collision one layer down, where
deleting profile A's event 1234 would have evicted profile B's 1234
from the React Query cache.

The review ran a seven-mutant battery (reversed key parsing, dropped
profile scoping in the cache predicate, bare-id selection, and so on);
every mutant died except one, and the survivor was itself the finding:
the owner-vs-fallback precedence was never exercised with a non-null
current profile, so the wrong-target mutant `effectiveProfileId ??
owner` survived a green suite. The fix round
([`6d1fe28`](https://github.com/ZoneMinder/zmNinjaNg/commit/6d1fe289))
added the discriminating test plus the review's real find: the
destructive selection queue survived profile switches - tick an event on
server A, switch away, and the confirm button would delete on a server
no longer displayed. The queue now clears at every profile-context
change (switch, delete, delete-all
[`48ae505`](https://github.com/ZoneMinder/zmNinjaNg/commit/48ae5059),
disable), each clear pinned by its own test, with the placement subtlety
tested too: a REJECTED switch keeps the queue, because the context never
changed.

### 4.3 The Streaming Mode that did not exist

The controls wave
([`f30d630`](https://github.com/ZoneMinder/zmNinjaNg/commit/f30d6300),
[`8b9b2e7`](https://github.com/ZoneMinder/zmNinjaNg/commit/8b9b2e74),
[`980859d`](https://github.com/ZoneMinder/zmNinjaNg/commit/980859d2))
enabled the ~20 controls and produced the program's best Critical, worth
telling in full because every actor did their job and the defect still
nearly shipped.

The two-tier design rule says view preferences in All mode come from the
ALL settings bucket. The implementer duly made the stream path read the
ALL bucket's `viewMode`. The reviewer then asked the question nobody
had: who WRITES that value? The answer was nobody - the only Streaming
Mode control in the app wrote to the picked server's bucket, never the
sentinel's, and the merged default for an unwritten bucket is
`snapshot`. So the commit's own description ("tiles now follow the All
Servers Streaming Mode setting") referred to a setting that did not
exist, and every All-mode montage would have become permanent stills
with no reachable state that restores streaming. The reviewer proved it
with a runtime probe, and pointed at the implementer's own test as
evidence: it had to hand-seed
`updateProfileSettings(ALL_PROFILES_ID, {viewMode:'streaming'})` - a
state no user action could produce.

The fix attempt then hit a second wall that only the live browser
found. The clean design - treat "unset" as "per server" - is
unimplementable in this codebase: the settings store seeds a fresh
bucket with the entire defaults object on the first write of ANY key,
and the app writes `lastRoute` on the first navigation, so "unset" is
not a state a bucket can stay in. The unit suite passed the clean
design; the e2e failed it on first contact (`Expected substring: "Per
server", Received string: "Snapshot"` on a montage that had only been
navigated to). The shipped design
([`52e2bd6`](https://github.com/ZoneMinder/zmNinjaNg/commit/52e2bd61))
is a separate explicit tri-state, `allModeViewMode:
'per-server'|'streaming'|'snapshot'`, defaulting to per-server so
nothing changes until asked. The seeding trap went into the developer
guide so nobody retries absence-as-state, and the re-reviewer - who had
recommended the clean design - withdrew its own recommendation on the
evidence: "it would have shipped the bug back within one navigation."

One more catch in the same wave belongs to the gates, not the
reviewers: the analysis-frames rework briefly shipped a short-circuited
hook call (`!alwaysStreaming && usePageViewMode()`), a genuine
rules-of-hooks violation. The ratchet config allows zero of those, so
the gate failed the commit before any review saw it - the cheapest
catch of the day.

### 4.4 Filter persistence, and the first agent death

The filters task retargeted Events/Timeline filter persistence to the
current aggregate bucket with composite monitor tokens
([`6a607c4`](https://github.com/ZoneMinder/zmNinjaNg/commit/6a607c40)).
Its implementer died mid-task - a usage-limit kill - leaving one commit
plus uncommitted edits. The recovery is worth describing precisely
because it shows what the audit-first rule buys. The uncommitted diff
REVERTED the committed fix; read naively, that looks like the agent
changing its mind. Read against the process, it is recognizable as the
prove-red-by-reverting-the-guard technique mid-flight: the agent had
written its e2e scenario, reverted the fix to watch the scenario fail,
and died before restoring. The orchestrator discarded the reversion
(the commit is authoritative), kept the scenario, verified it green
against the live server, and committed it with the recovery documented
in the message
([`4983a29`](https://github.com/ZoneMinder/zmNinjaNg/commit/4983a290)).
The subsequent review found the recovered state coherent and added one
insight: the restore-path guard was unreachable symmetry, proven by the
fact that reverting it left all 54 tests green - so it was documented as
symmetry at the guard itself rather than pretended to be covered
([`5de836e`](https://github.com/ZoneMinder/zmNinjaNg/commit/5de836ed)).
One instruction-file fix rode along under the self-improvement protocol:
the Aggregation contract's "data prefs" wording would have wrongly
flagged this very fix, and became "server-scoped prefs" in a
one-for-one word swap that kept the 2,000-word budget gate green
([`bd0da65`](https://github.com/ZoneMinder/zmNinjaNg/commit/bd0da657)).

### 4.5 The fan-out wave and the empty-resolution leak class

Shortcuts, palette, and tags fanned out
([`4016b57`](https://github.com/ZoneMinder/zmNinjaNg/commit/4016b57b),
[`c38ab31`](https://github.com/ZoneMinder/zmNinjaNg/commit/c38ab311),
[`d7951884`](https://github.com/ZoneMinder/zmNinjaNg/commit/d7951884)).
Two defects here define a class worth naming: **empty resolution must
mean an impossible filter, not no filter.** The implementer found the
first instance itself: filtering by a tag that only server A defines
resolved to an empty id list on server B, and the API layer treated an
empty list as "no filter" - so server B would have contributed EVERY
event to a filter meant to narrow. It fixed that and flagged, without
being asked, that the monitor filter had the identical defect one file
over, where the existing test ENCODED the wrong behavior
(`expect(callFor(profileB)?.monitorId).toBeUndefined()`). The reviewer
confirmed it with a proven-red (B's event appearing in a filter for A's
cameras), specified the fix shape with a warning attached - do not use
`enabled: false`, because the aggregation combine treats an all-disabled
scope as loading forever - and the fix landed with the defect-encoding
assertion rewritten
([`c7de7f1`](https://github.com/ZoneMinder/zmNinjaNg/commit/c7de7f1d)).

The same review caught a performance regression invisible to every
test: the new tag hook returned a `Map` from React Query's `combine`,
and query-core's `replaceEqualDeep` only stabilizes plain arrays and
objects - so the map's identity churned every render, which recomputed
the row list, which minted fresh row objects, which defeated
`memo(EventItem)` for every card on every Events render. Proven red
with `expected Map{…} to be Map{…} // Object.is equality`, fixed by
returning entry arrays and building the Map in `useMemo`
([`77489f2`](https://github.com/ZoneMinder/zmNinjaNg/commit/77489f2e)).

The wave also produced the best debugging story of the day. Enabling
the global Escape shortcut broke a previously-passing e2e scenario. The
implementer bisected to its own commit, probed the DOM state at the
failing keydown (`{poppers: 0, panel: false, target: BODY}` - the app
was behaving correctly), diagnosed the STEP as the defect (it pressed
Escape unconditionally; applying a filter had already dismissed the
popover, so the stray Escape hit the now-live back shortcut and
navigated off the page), fixed the step, built a speculative
component-level guard for a suspected Radix race, proved it red/green,
and then DELETED it once the probe showed the race was not happening.
No speculative code shipped. The app-level safety question the incident
raised - can global Escape fire under an open dialog? - was separately
verified: a real overlay guard covers Radix dialogs, popovers, and
dropdowns.

### 4.6 The performance settings section, and an understated self-report

Task 6 made every All-mode tuning knob user-visible and editable
([`8ffe527`](https://github.com/ZoneMinder/zmNinjaNg/commit/8ffe5278),
[`38cbe72`](https://github.com/ZoneMinder/zmNinjaNg/commit/38cbe729)) -
the maintainer's second directive made real: stream cap, watch cap,
poll floor, burst window, plus three rows plumbed for the optimizations
to come. Two process incidents matter more than the feature here.

First, a [P3](../../../AGENTS.md#process) breach with a lesson about
gate scoping. The implementer self-reported committing once on a broken
test; the reviewer bisected and found the breach spanned FOUR commits -
the broken suite was `LiveActivity.test.tsx`, whose hand-listed settings
fixture silently missed the new keys, and the per-commit scoped gates
missed it because that file does not import the changed module. The
correction is now a playbook rule: scoped gates must include suites that
CONSUME a changed settings shape, not just files importing the changed
file. Second, the honest-numbers norm held under small stakes: when a
later cleanup dropped the lint backlog by one, the implementer first
attributed it to the wrong cause, checked before committing, and
corrected itself - the commit message carries the true cause (a test
mock's `any` annotation removed), because per
[M2](../../../AGENTS.md#meta-governs-this-file) the number must describe
what it claims.

The wave also fixed a real input bug its own review found: the shared
clamped-number field committed fractional values the store would round
on read, so typing 2.5 left the field showing 2.5 forever while every
consumer used 3, with the raw 2.5 persisted
([`736ed2f`](https://github.com/ZoneMinder/zmNinjaNg/commit/736ed2f4)).
Fixed in the shared hook rather than the caller, because the Live
Activity dialog's three fields had the same latent desync - the
root-cause rule applied at the right layer.

### 4.7 The stream-lifecycle waves: where the process was tested hardest

The optimizations task
([`e4e7835`](https://github.com/ZoneMinder/zmNinjaNg/commit/e4e7835a)
per-server budget,
[`99ecd9a`](https://github.com/ZoneMinder/zmNinjaNg/commit/99ecd9a4)
reduced tuning,
[`6bc7b12`](https://github.com/ZoneMinder/zmNinjaNg/commit/6bc7b120)
pause-when-hidden,
[`4f91a5d`](https://github.com/ZoneMinder/zmNinjaNg/commit/4f91a5da)
idle downgrade) touched the subsystem with the project's worst defect
history, and the history repeated on schedule: the review found a HIGH
in exactly the historic class, the fix contained a blocker of its own,
and only the third pass shipped clean. The full anatomy:

**The HIGH: idle downgrade orphaned the streaming connkey.** The idle
feature flipped tiles to snapshot mode via a `viewMode` override -
but the stream lifecycle hook regenerates and quits only on
`[monitorId, enabled]`; a viewMode change is not a lifecycle event. So
the flip sent no CMD_QUIT (the server-side `nph-zms` process stayed
up), and worse, the cleanup params were rewritten to say "snapshot"
before any teardown ran, and the quit function early-returns for
non-streaming params - so the unmount and disable teardowns could never
quit that key either. The reviewer's probe recorded ZERO quit requests
across flip and unmount where the control case records one. Every
All-mode tile would leak a server process after every idle period. The
root cause predated the wave (a user manually toggling Streaming Mode
leaked the same way), so the fix landed at the root: a
streaming-to-snapshot transition is now itself a teardown event
([`314cf52`](https://github.com/ZoneMinder/zmNinjaNg/commit/314cf52c)),
closing the manual case too. The implementer's report is worth quoting
for what the review loop is for: its first guard was wrong (a surviving
mutant told it so), its second guard was wrong for a subtler reason,
and the shipped identity-comparison guard was the third attempt - each
iteration forced by a test that refused to pass.

**The blocker inside the fix: the quit missed on multi-port installs.**
The re-review found that the forced teardown restored `viewMode` into
the quit parameters but not `minStreamingPort`, which co-varies with
viewMode - so on any multi-port ZoneMinder (a common configuration),
the CMD_QUIT went to the portal's default port, the leak survived, and
the app now LOGGED a successful quit: worse than the silent original.
The reason no test saw it is an
[M2](../../../AGENTS.md#meta-governs-this-file) lesson: the test's
`getZmsControlUrl` mock dropped the port argument entirely, so every
quit URL in the suite looked identical - the gate's input did not
measure what the gate claimed. Round 2
([`ccf108e7`](https://github.com/ZoneMinder/zmNinjaNg/commit/ccf108e7))
carried the port through the identity ref, made the mock mirror the
real port math, and asserted the PORT in the quit URL. The re-reviewer
then probed the case neither side had written - a port change WITHOUT
a flip, then a flip - and found the ref-update ordering handled it
correctly, quitting on the port the stream had actually moved to.

Alongside the HIGH: pause left the visibility-resume hook's away-marker
stale (the next quick tab flick reconnected every tile at once - the
reconnect storm the grace period exists to prevent), and pause left the
frames-latch set (resume re-armed the freeze watchdog against a stream
that had not reconnected, burning retries on slow resumes). Both proven
red, both fixed in
[`b464435`](https://github.com/ZoneMinder/zmNinjaNg/commit/b464435e).
And of ten mutants the reviewer ran across the wave, exactly one
survived - the watchdog interlock, the single lever protecting the
defect class the task existed for - and that became its own finding
with its own now-failing test.

### 4.8 Viewport gating: the bugs only a real browser shows

The final optimization
([`cf853c3`](https://github.com/ZoneMinder/zmNinjaNg/commit/cf853c30))
gates off-screen montage tiles from holding connections. Its implementer
did the thing the unit tier cannot: drove the real montage in Chromium
with the knob on, and found that NO tile ever streamed - two real bugs
invisible to 3,800 unit tests:

- react-grid-layout clones every child with its own ref, silently
  REPLACING the tile's ref, so the observed element was never
  registered. The fix moved the observed element one level in, and the
  test mock now clones-with-ref the way the real library does, so the
  class fails at unit tier from now on
  ([`c8d0d83`](https://github.com/ZoneMinder/zmNinjaNg/commit/c8d0d833)).
- The per-tile ref-callback cache dropped entries on detach, so React
  saw a new callback each render and detached/re-attached the observer
  in a loop, seeded by StrictMode's own double-mount.

Both went into the domain playbook the same day. The review then found
the wave's own HIGH: the gating predicate included "observer root
exists," and the root is React state that is null on the first render -
so every tile rendered UNGATED for exactly one render, minting a
connkey, then gated on render two, quitting it: a 20-tile montage paid
20 mint/quit round trips on every page entry, the precise waste the
design document claimed to avoid. The entire suite passed because every
test read state after effects settled. The one-line fix (drop the root
from the predicate; the construction guard already handles it) came
with a first-render regression test using a render-recorder that
captures BOTH renders - against the old code it records `[false, true]`,
the mint-then-quit flash made visible
([`92a55c1`](https://github.com/ZoneMinder/zmNinjaNg/commit/92a55c1b)).
The same round produced the day's best pushback: I instructed an e2e
cleanup hook against cross-scenario state leakage; the implementer
rejected the instruction with evidence (Playwright runs each scenario
in a fresh browser context - no storageState, 24/24 login detections in
the logs - so the leak is structurally impossible and the hook would be
dead code), and the reviewer verified the config claim independently
and withdrew the finding. The framework's value is not that the
orchestrator is right; it is that being wrong gets caught in either
direction.

### 4.9 Cleanup: twenty parked items and a new gate

The cleanup wave closed every minor parked across the day - among them
a shared profile-chip component that turned out to be duplicated in
FOUR places, not the two the review had seen
([`2db6bef`](https://github.com/ZoneMinder/zmNinjaNg/commit/2db6befb));
ALL-bucket pruning for deleted monitors with a partial-knowledge
safety constraint
([`76777fc`](https://github.com/ZoneMinder/zmNinjaNg/commit/76777fc2));
a per-row subscription reduction
([`049fd3b`](https://github.com/ZoneMinder/zmNinjaNg/commit/049fd3b1));
and a NEW mechanical gate born from a review observation: nothing
checked that locale files carry the same `{{placeholder}}` sets as
English, so a translator dropping a parameter was invisible. The gate
([`ee8f22d`](https://github.com/ZoneMinder/zmNinjaNg/commit/ee8f22df))
was proven able to fail two ways before landing (dropped and renamed
placeholder), and its own floors were reviewed for
[M2](../../../AGENTS.md#meta-governs-this-file) honesty - the reviewer
found the en-key floor 2.7x below reality and had it raised so a
partial parse cannot report parity.

The wave also settled an advisory-lint annoyance properly: two
set-state-in-effect warnings on the Events page turned out to be the
"you might not need an effect" case - state that restated what the URL
and settings already said - and deleting the state dropped the lint
ratchet 205 to 203
([`ccc357d`](https://github.com/ZoneMinder/zmNinjaNg/commit/ccc357d5)).
The review then found the one seam that deletion left uncovered
(the montage-to-list toggle-back rode on a single unasserted line) and
the final commit pinned it at both tiers, with the e2e scenario that
was literally named "Switch between list and montage views" finally
switching back
([`7400f99`](https://github.com/ZoneMinder/zmNinjaNg/commit/7400f999)).
Its #342 contribution: the known events-suite flakes were re-attributed
by running the branch against a reverted baseline - identical failure
sets, so branch-exonerated - and the impossible-DOM-state analysis
(panel visible but its unconditional child missing) pointed the flake
at popover-mount timing, posted to the issue with the method's limits
stated.

Day totals: tasks 1-9 landed as roughly 50 commits, the unit suite grew
from 3,614 to 3,884, the ratchet fell 207 to 203 (the day-1 figure
counted one rule; these count the full 12-rule backlog), and the
all-profiles e2e feature grew from 12 to 24 scenarios.

---

## 5. Virtual profile groups (Aug 4-5): generalize, then retire

The maintainer asked whether "All Profiles" could become "Multiple
Profiles" - named groups of servers. The assessment said medium, not
huge, for one architectural reason: every aggregate surface fans out
over `useProfileScope().profiles` and none of them care which profiles
are in the array. The program that followed is the best evidence in
this report that the earlier work's structure held, because the feature
landed in three waves with the aggregation core untouched.

### 5.1 Audit-first, and the one decision that shaped the diff

A read-only audit inventoried every site assuming exactly one aggregate
id: 54 non-test sites in five classes (scope-derived, predicate,
write-target, literal, guard), each classified by what would break. Its
key finding was not a bug but a constraint: service modules compare
profile ids without store access, so the virtual id scheme had to be
answerable from the id's shape alone. That produced the spec's first
decision - prefixed ids (`__virtual_<uuid>`) with a pure-string
predicate - which collapsed two whole classes of the sweep to
mechanical edits. The spec
([`7015c18`](https://github.com/ZoneMinder/zmNinjaNg/commit/7015c18f))
recorded twelve decisions, including flat-only membership (nesting
flattens to a member list anyway, so banning it costs nothing and
deletes cycle handling, settings ambiguity, and recursive resolution)
and fully independent settings buckets (live inheritance would need
absence-as-state, which section 4.3's seeding trap already proved
unimplementable - the trap paid for itself within a day of being
documented).

### 5.2 Wave A: the ownerless socket, and mechanically-right-semantically-wrong

Wave A ([`204ae10`](https://github.com/ZoneMinder/zmNinjaNg/commit/204ae10e),
[`e83b0f1`](https://github.com/ZoneMinder/zmNinjaNg/commit/e83b0f1f),
[`25f9033`](https://github.com/ZoneMinder/zmNinjaNg/commit/25f90330),
[`b80fdbe`](https://github.com/ZoneMinder/zmNinjaNg/commit/b80fdbeb))
made virtual ids representable and safe with no UI. The review's
MEDIUM is the program's most instructive defect: the notification
store's guard said "do not tear down a connection while an aggregate is
current," extended mechanically from the All Servers case. For All
Servers that is correct because every enabled profile is a member. For
a group it is wrong: a profile whose connect was in flight when the
user switched to a group that EXCLUDES it kept its socket with no
connector owning it - live for the session, streaming events for a
server outside the current scope. The reviewer proved it with a probe
(connect A in flight, switch to a group of only B, resolve: A reads
`connected`), and the fix
([`d7f5699`](https://github.com/ZoneMinder/zmNinjaNg/commit/d7f56993))
replaced the predicate with an ownership helper whose four cases
(member kept, non-member dropped, missing-group dropped, ALL keeps
all) each die under their own mutation. The general lesson got a name
in the review: a guard extension can be mechanically correct and
semantically wrong the moment "aggregate" stops implying "everything."

The same round hardened the store against its future UI (blank names,
ghost members, nested groups all rejected at the write, in one shared
validator pinned on both call paths) and tightened the new sentinel
gate after the reviewer showed the prefix grep missed suffixed
literals - the tightened gate's first catch was the implementer's own
test ids ([`344f709`](https://github.com/ZoneMinder/zmNinjaNg/commit/344f7094)).

### 5.3 Wave B: the sweep, ordered so no commit is wrong

The generalization sweep
([`79424dd`](https://github.com/ZoneMinder/zmNinjaNg/commit/79424dd3),
[`67a8833`](https://github.com/ZoneMinder/zmNinjaNg/commit/67a88337),
[`4e35449`](https://github.com/ZoneMinder/zmNinjaNg/commit/4e35449f),
[`38e3bce`](https://github.com/ZoneMinder/zmNinjaNg/commit/38e3bce0))
was committed in a deliberate order: every write target, label, and
read resolved the active aggregate BEFORE the predicate widened, so no
intermediate commit could render aggregate UI that wrote the wrong
bucket - verified by the reviewer building the middle commit standalone.
The implementer caught a bug the brief would have caused: with the
predicate widened, the "All Servers" entry would have shown as SELECTED
whenever a group was current; the fix kept the narrow sentinel check on
exactly the All-entry sites and added a testid so the absence is
assertable. Proven-reds here used opposite-values seeding (ALL bucket
says snapshot, group bucket says streaming) so only the correct read
can pass. The review's two MEDIUMs were both coverage, not behavior -
the Dashboard read and write targets survived an ALL-hardcode mutation
with the full suite green - and the fix round
([`35822ff`](https://github.com/ZoneMinder/zmNinjaNg/commit/35822ff6))
pinned them with a case that cannot pass by accident: widgets ONLY in
the ALL bucket while a group is current must show NO chrome.

### 5.4 Wave C: the keyboard trap

The visible wave
([`0c44459`](https://github.com/ZoneMinder/zmNinjaNg/commit/0c444595),
[`dc006f8`](https://github.com/ZoneMinder/zmNinjaNg/commit/dc006f87),
[`043625b`](https://github.com/ZoneMinder/zmNinjaNg/commit/043625ba))
shipped the cards, dialog, and switcher entries, with an e2e lifecycle
scenario whose discriminator was mutation-anchored (breaking scope
resolution fails exactly at "every monitor profile chip should name
Second"). The review's HIGH is the arc's best accessibility catch: the
group card is the first element in the app that is both
`role="button"` and contains inner buttons, and its keydown handler
fired for keys bubbling up FROM those buttons - so a keyboard user
pressing Enter on Edit got `preventDefault` (killing the button) and
then a profile switch. Measured: `onEdit` 0 calls, `onSwitch` 1.
Mouse worked, a11y lint passed (it cannot model nested interactives),
and no precedent existed to copy. The one-line origin guard
([`0c9ac6f`](https://github.com/ZoneMinder/zmNinjaNg/commit/0c9ac6fd))
filters by event origin rather than by key, covering future inner
controls too, and the fix round also closed a spec deviation (group
names now trim before the availability check - the ordering that makes
"Backyard " collide with "Backyard" instead of slipping past
[`f8c0076`](https://github.com/ZoneMinder/zmNinjaNg/commit/f8c00767))
and guarded the zero-active-members dead-end
([`4764097`](https://github.com/ZoneMinder/zmNinjaNg/commit/47640979)):
such a group stays fully editable but refuses the switch, keeping
`aria-disabled` with focus so screen-reader users hear why instead of
watching the card vanish from the tab order.

### 5.5 The retirement: an override, a migration, and a second death

My recommendation was to keep All Servers (its membership is dynamic;
groups are static lists). The maintainer overrode it - "virtual profile
group supersedes it" - and the override is recorded with its accepted
consequence: adding a server no longer auto-aggregates anywhere. The
removal
([`d2624564`](https://github.com/ZoneMinder/zmNinjaNg/commit/d2624564))
kept every guard and the sentinel machinery (groups run on it; legacy
stored state needs it) and shipped an
[I2](../../../AGENTS.md#invariants-never-simplified-away)-grade
migration
([`75dbc02`](https://github.com/ZoneMinder/zmNinjaNg/commit/75dbc025)):
a persisted All Servers selection resets to profile selection once,
its orphaned settings and dashboard buckets are deleted, and a user who
never used All mode sees zero writes. The reviewer verified durability
at the source - reading zustand's persist middleware to confirm the
captured `set` is the persisting one - and separately established that
the zero-writes property holds only because the calls sit inside the
sentinel guard, not because of the store's early-returns, since
zustand persists on every `set` regardless.

The first removal implementer died mid-task (an API connection drop),
leaving those two commits unreviewed plus uncommitted e2e edits. The
recovery agent audited rather than trusted: it re-proved the migration
red itself, checked that the MOCKED store methods exist by name in the
real modules (a wrong name would have passed every test and crashed at
runtime), judged the uncommitted e2e migration coherent, and completed
the wave - every one of the 25 scenarios found a group-expressible
form, none dropped, with the settings-independence proof upgraded to
two groups holding different Streaming Modes across reloads
([`2a4621b`](https://github.com/ZoneMinder/zmNinjaNg/commit/2a4621b9)).
The review's findings were all docs and dead code - among them one
instructive inversion: the removal added an explicit "sentinel
rejected" branch plus a test, and the reviewer proved the branch
unreachable (the widened membership check already rejects it) and the
test unable to fail for the code it named; the fix deleted the branch
and re-aimed the test at the check that does the work
([`7f18eab`](https://github.com/ZoneMinder/zmNinjaNg/commit/7f18eabf),
[`140d307`](https://github.com/ZoneMinder/zmNinjaNg/commit/140d307b),
residuals [`7ec3cf3`](https://github.com/ZoneMinder/zmNinjaNg/commit/7ec3cf38)).
Both PRs merged to main the same morning
([`86d27df`](https://github.com/ZoneMinder/zmNinjaNg/commit/86d27df4),
[`61dca16`](https://github.com/ZoneMinder/zmNinjaNg/commit/61dca165)),
followed by a terminology rename to "virtual profile groups" with
pixel-measured 320px label checks per locale
([`8f96f05`](https://github.com/ZoneMinder/zmNinjaNg/commit/8f96f058)).

Program totals: audit, spec, three feature waves, rename, retirement -
roughly 45 commits, suite 3,884 to 3,992 (the retirement deleted the
All-card tests after the peak of 4,001), ratchet 203 to 202, word
budget ending 1,996 of 2,000.

---

## 6. Where the process cost time, split by cause

The maintainer asked me to separate failures of the rules from failures of
the surrounding framework. On review, most of the friction came from the
framework and from my own plan-writing, not from the rules.

### 6.1 Failures of the process design (the rules' side)

**My briefs contained defects, and the process amplified them.** The
implementer/reviewer split means implementers faithfully build what the
brief says, so a wrong brief produces wrong code with full test coverage. The phase 0 brief mandated the exact
call pattern that broke self-signed onboarding; it also named a settings
field that did not exist (`trustSelfSignedCerts` for the real
`allowSelfSignedCerts`). The phase 1 plan placed a constant in a file
where importing its type closes a real dependency cycle; the implementer
had to prove the cycle empirically before deviating. All were caught, but
each cost a round, and the root cause was upstream of every rule: the
orchestrator's unverified assumptions, written confidently into briefs.
The fix is not a new rule so much as humility in plan-writing, but one
mechanical lesson was recorded: verify field names and import graphs
against the tree before they go into a brief.

**The brief-extraction script drops dispatch context.** Task briefs are
extracted from the plan file, but dispatch prompts often add rulings and
scope on top. Reviewers only see the brief. In phase 3 this produced a
formal "undisclosed scope creep" finding against work my own dispatch had
explicitly ordered, wasting a round on a misunderstanding. Rule now
recorded in the
[workflow playbook](../../../agents/generic/claude-workflows.md): the
brief file is the reviewer's
contract, so anything added at dispatch time must be folded into it.

**The one-fix-wave rule under-budgets concurrency work.** The
subagent-development skill says a whole-branch review gets one fix
dispatch and one re-review, then residuals are parked. Both whole-branch
fix waves introduced at least one new Critical or Important defect of
their own, and the multi-connection increment needed four rounds, each
justified by a defect the previous round created. I broke the rule's
letter twice, deliberately and with ledger entries, because parking a
fresh single-mode regression would have been worse than the extra round.
The rule's intent (prevent endless churn) is right; its budget assumes
fixes do not create Criticals, and on lifecycle/concurrency code they
reliably do. The playbook now says to budget re-reviews per wave on such
subsystems.

**Two rules were in unplanned tension.** The standing memory says to stop
idle subagents promptly; the re-review pattern wants the original
reviewer, with its context, to verify the fix. Twice I killed a reviewer I
then needed and paid for a cold respawn. Converged practice, now written
down: a task's reviewer lives until its scoped re-review completes.

**Reviewer model tier was chosen by size, and should have been chosen by
risk.** The evidence: the four subtlest defects of the project (socket
leak, reschedule deadlock, backoff defeat, resident-cap dwell bypass) were
all found by the top-tier model, and one of them came from a top-tier
*task* review, so it was the tier and not the wider scope that mattered.
Where I economized on concurrency-heavy diffs, defects survived exactly
one round longer, until the stronger pass. Nothing in the rules said how
to pick the tier; that judgment call is now a playbook line.

**One process gap had no rule at all: concurrent access to one worktree.**
`git commit` commits the whole index, not the files you just staged. An
implementer's commit swept my staged doc files (caught and recovered), and
later my own one-line commit swept the docs agent's staged files, which is
why the user-doc updates sit under the mislabeled commit
[`310335e`](https://github.com/ZoneMinder/zmNinjaNg/commit/310335e)
instead of their own message. Content is intact and verified, but the
[P5](../../../AGENTS.md#process) one-commit-one-change rule was broken by
accident twice in one night. The
conclusion: staging by explicit path is not sufficient; either one
committer at a time, or worktree isolation for agents that commit. This
was operator error combined with git's whole-index commit behavior, not a
defect in any written rule, but no written rule prevented it either.
The class struck a third time on Aug 5, in a new shape: another agent
working an unrelated issue SWITCHED the shared checkout's branch between
my edit and my commit, so the commit landed on their branch. The naive
recovery (`git reset --hard`) would have destroyed their staged work;
the actual recovery used `reset --soft` plus a single-path restore, and
the commit moved to its target via a temporary worktree. The rule that
came out of it is now in the playbook: verify the current branch
immediately before every commit, and make out-of-band commits from a
temporary worktree, never the shared checkout.

**Cadence: what actually consumed wall-clock without buying safety.**
Measured against the whole arc, four habits - none of them required by
any rule - were the real time sinks, and all four are now playbook
lines: briefs cited line numbers that rotted within hours on an active
branch (every implementer paid a re-verification pass); reviewer-
specified one-line fixes went through full re-review rounds early on
(later practice: the orchestrator inspects those diffs directly);
mutation batteries ran up to three times per finding (implementer
proves red, review runs its battery, re-review re-applied everything -
the third pass now re-applies only finding-linked mutants); and full
gate runs (~3-4 minutes each) ran roughly 25 times in one day when
[P3](../../../AGENTS.md#process) only requires the full suite at push.
None of these were rule defects; all were orchestration habits that a
future run can drop without losing a single catch, which is exactly why
they are recorded.

### 6.2 Failures of the framework (not the rules)

These cost real time and none of them are addressable by editing
[AGENTS.md](../../../AGENTS.md). I list them separately because a reading of the session log
that does not make this distinction would attribute all of it to the
process.

To be precise about what is and is not being criticized here: the
multi-agent approach itself is not. Running ~40 agents was the
orchestrator's scaling choice for a four-phase feature with a review per
task, the parallelism delivered the two-day timeline, and nothing below
argues for fewer agents. The problems below are defects in the harness
that any agent count would have hit; they made each agent interaction
noisier than it should be.

- **Subagent report delivery is unreliable.** Roughly a third of
  completions arrived as a bare idle notification with no report attached;
  each needed a "resend via SendMessage" nudge. Worse, agents' sends to
  the "main" address sometimes errored with "you are the main
  conversation," so the working pattern became "send to main, fall back to
  the orchestrator's name," discovered by trial. Later dispatches baked
  the instruction in and the problem mostly stopped, but I count perhaps
  ten to fifteen wasted exchanges before that stabilized.
- **Stale idle pings from stopped agents.** Stopped agents kept emitting
  idle notifications that arrive as messages and have to be read and
  dismissed. Dozens of them across the run. No rule change addresses this;
  it is framework noise and belongs on a framework issue list.
- **Four agent deaths across the arc** - host reboot and network drop in
  program 1, a usage-limit kill mid-task in program 2, and an API
  connection drop mid-task in program 3. All four left half-done work
  with no handoff note; all four were recovered by the audit-first
  pattern (sections 3.6, 4.4, 5.5), including one where the dead agent's
  uncommitted diff was a prove-red reversion that would have looked like
  a regression to anyone not reading it against the process. The
  recoveries worked; the deaths and the silence are framework
  properties the ledger compensates for but cannot prevent.
- **The npx-from-the-wrong-directory trap** cost three separate
  incidents before it was written down: a shell whose working directory
  drifted after git commands ran `npx vitest` from the repo root, which
  resolves a cached install without the project's jsdom config and fails
  dozens of tests with `document is not defined` - a failure shape
  indistinguishable from a real regression until the raw output is read
  ([P6](../../../AGENTS.md#process) again). It is now a playbook trap
  entry, and the third near-miss was recognized from the entry within
  seconds.
- **Output-summarizing wrappers** (the rtk tee) hid a suite failure once.
  The project already distrusts them by rule
  ([P6](../../../AGENTS.md#process)), which is how the
  failure was caught, but the rule exists specifically to defend against
  this piece of tooling.
- **A resumable-agent limitation**: stopped agents cannot be re-messaged
  ("no agent named X is reachable"), so continuing a task after a stop
  means a fresh spawn and re-established context. This shaped the
  keep-reviewers-alive practice above.

### 6.3 Weak spots that are neither rules nor framework

**End-to-end testing was the least reliable form of verification, and
the cause is infrastructure.** All e2e runs share one live ZoneMinder demo server with
parallel workers. Over repeated same-day runs it degrades: one full run
showed 14 flaky-passes and 5 hard failures. The five failures were proven
pre-existing by checking out the pre-branch baseline and running the same
scenarios there; that check took most of an afternoon and prevented us
from "fixing" tests our code never broke. The remaining facts are less
comfortable: the five failures now stand as a documented tolerated set
([#342](https://github.com/ZoneMinder/zmNinjaNg/issues/342)), the
most concurrent code in the project (websockets, alarm polling) is
covered by unit tests only, and two of my own new scenarios needed
timing rewrites after their first live run
([`f6c21e8`](https://github.com/ZoneMinder/zmNinjaNg/commit/f6c21e89),
[`84372f8`](https://github.com/ZoneMinder/zmNinjaNg/commit/84372f89)).
Unit and component tests carried the real verification weight all
weekend.

None of that is an argument against live e2e. It was the only check that
exercised the feature against a real ZoneMinder server, end to end: the
twelve all-profiles scenarios (aggregate pages, deep routes, profile
switching, the disabled-profile filter) all pass, and the timing rewrites
my two scenarios needed were e2e doing its job, exposing real-server
behavior no mock reproduces. The verdict is keep it and fix the
infrastructure it runs on, which is what
[#342](https://github.com/ZoneMinder/zmNinjaNg/issues/342) tracks; the
failure would be letting the tolerated-failure list quietly grow instead.

**The render-loop selector class recurred five times despite being
caught every time.** The workflow detected each instance but did not
prevent recurrence until the closeout wrote the pattern into the
[Stores contract](../../../AGENTS.project.md#stores) and the
[testing playbook](../../../agents/project/testing.md). Detection worked; prevention did not
exist until the end, and whether the new contract text prevents the next
instance is untested.

---

## 7. Things I cannot fairly judge

- Whether plain test-first (as opposed to the proven-red discipline, which
  I could verify) changed outcomes. Implementers reported failing-first
  consistently, but I cannot distinguish a genuinely test-driven task from
  a well-reported one from where I sit.
- Whether the issue-linkage rule
  ([P1](../../../AGENTS.md#process)) prevented anything. Every commit
  references [#337](https://github.com/ZoneMinder/zmNinjaNg/issues/337)
  and the PR trail is clean, which has archival value, but
  I saw no incident where the linkage itself caught or prevented a
  mistake. When the maintainer said to stop filing new issues mid-flow,
  folding increments into the umbrella issue worked fine.
- Several rules simply never came under pressure: the one-file-folder
  rule ([C5](../../../AGENTS.md#code)), the merge-without-approval rule
  ([P8](../../../AGENTS.md#process)), the typo-exemption in
  P1. No violations, no tests of their value either. Absence of incidents
  is consistent with "working silently" and with "irrelevant this run";
  the available evidence cannot distinguish the two.
- The overhead estimate. My best judgment is that workflow mechanics
  (dispatch writing, ledger upkeep, review packaging, nudges) consumed
  fifteen to twenty percent of total effort, but nobody was timing
  individual activities, so treat that as an estimate by the person who
  did the work, not a measurement.

---

## 8. Conclusion

The facts that support the workflow, across the full arc. In program 1,
ten user-visible defects were caught before merge, several of them
regressions in the single-profile mode the project promised not to
touch. Programs 2 and 3 - run when the easy defects were gone - added
at least a dozen more substantive catches, and the profile of those
catches is the argument: the unwritable Streaming Mode that would have
turned every All-mode montage into stills (4.3), a server-process leak
on every idle cycle plus a wrong-port quit hiding inside its own fix
(4.7), a cold-mount mint-and-quit per tile that inverted an
optimization's purpose (4.8), an ownerless socket for excluded profiles
(5.2), a cross-server filter that showed everything instead of nothing
(4.5), and a keyboard path that switched profiles when the user meant
"edit" (5.4). Every one was plausible, tested, and green when it
arrived at review; every one was proven by probe or mutation rather
than argued; several were found in fixes for the previous finding,
which is precisely the case self-review cannot handle.

The same period stress-tested the operational half: four agent deaths,
a LAN outage, and a shared-checkout branch race were all recovered
without losing work, using the ledger, audit-first recovery, and - in
the last case - a recovery that had to protect ANOTHER agent's staged
work while extracting a misplaced commit. The mechanical gates fired
against implementers, against the orchestrator, and once before any
reviewer saw the diff. The maintainer overrode the orchestrator's
recommendation once (retiring All Servers) and the process recorded the
override with its accepted cost and shipped it with an I2-grade
migration - disagreement flowing in both directions and ending in the
repository, not in a chat log.

The costs, honestly: briefs with defects that implementers faithfully
built; brief line numbers that rot; a fix-wave budget that concurrency
work overran every time it was tried; roughly a day-equivalent of
wall-clock across the arc spent on cadence habits no rule required
(triple mutation runs, ~25 full gate runs in a day, re-review rounds on
reviewer-designed one-liners); and a messaging layer that needed
babying throughout. All of the process-side costs now have playbook
lines; the framework-side ones have a list for upstream.

My assessment stands, strengthened: the workflow helped decisively, and
the margin GREW as the work got harder - the stream-lifecycle and
guard-semantics catches of programs 2-3 are ones I would not expect any
single-context session to make, because they required a second reader
whose only job was disproof. The distilled version for any future
project: keep the independent review loop with per-round re-reviews,
keep the mechanical gates, keep the ledger, write the traps down where
the next agent must read them, and spend the saved ceremony from
section 6.1's cadence list on nothing at all.

## 9. Follow-ups this report feeds

1. A mechanical gate for composite ids in aggregate paths, the
   six-incident class (tracked; the
   [Aggregation contract](../../../AGENTS.project.md#aggregation-all-servers-mode)
   currently says
   "review" honestly instead of overclaiming).
2. The render-loop selector rule and real-store test requirement are now
   in the [Stores contract](../../../AGENTS.project.md#stores) and
   [testing playbook](../../../agents/project/testing.md); their
   effectiveness is
   unproven until the next feature.
3. e2e infrastructure
   ([#342](https://github.com/ZoneMinder/zmNinjaNg/issues/342)):
   shared-server flakiness needs a real
   answer (worker cap, dedicated server, or mocks) with an expiry, so the
   tolerated-failure list does not become permanent.
4. Live Activity aggregation closed the
   [#341](https://github.com/ZoneMinder/zmNinjaNg/issues/341) gap during
   this run; nothing
   from the original spec remains undelivered.
5. Framework issues worth reporting upstream rather than working around:
   report delivery reliability, stale idle pings from stopped agents,
   the inability to resume a stopped agent, and mid-task kills (usage
   limits, connection drops) that leave no handoff state.
6. Accepted migration debt on
   [#337](https://github.com/ZoneMinder/zmNinjaNg/issues/337): ~40 unit
   suites still use the retired sentinel as a stand-in aggregate id in
   scope fixtures (they exercise the shared aggregate paths but never
   membership filtering or group naming; loud, not silent, if the
   sentinel ever stops resolving), and the tag-name-in-URL cross-mode
   degeneracy documented at its write site.
7. The five cadence lessons of section 6.1 are in the
   [workflow playbook](../../../agents/generic/claude-workflows.md);
   their test is whether the next program's wall-clock drops without
   its catch-rate dropping.
