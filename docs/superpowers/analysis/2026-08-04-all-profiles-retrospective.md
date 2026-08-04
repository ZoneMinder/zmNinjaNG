# All Profiles: a retrospective on the agent workflow

Written 2026-08-04 by the orchestrating agent, at the maintainer's request, to
answer one question honestly: did the agent framework this repository built
actually help, or did it get in the way?

Context for readers outside this project. zmNinjaNg is a mobile and desktop
client for [ZoneMinder](https://zoneminder.com/), an open-source video
surveillance system. Users configure one "profile" per ZoneMinder server
(URL, credentials, TLS settings); a "monitor" is a camera, an "event" is a
recorded clip, and the Event Server (ES) is ZoneMinder's optional push
notification daemon. Until this work, the app could talk to exactly one
server at a time.

The framework under evaluation is checked into this repository:
[`AGENTS.md`](../../../AGENTS.md) (portable process and code rules with
stable IDs such as P2 or C7), [`AGENTS.project.md`](../../../AGENTS.project.md)
(architecture contracts with named enforcement gates), the playbooks under
[`agents/`](../../../agents/) (per-domain working notes agents must read
before touching an area), and a subagent process: an orchestrating agent
writes per-task briefs, separate implementer agents build them test-first,
separate reviewer agents check each diff, and mechanical test gates block
commits that break declared invariants. The comparison baseline throughout
this report is standard Claude Code: one agent in one session, no
repository-specific rules, self-review only.

A note on method. This report is compiled from two sources: the git history
of the two feature branches, and the orchestrator's own session record of
every dispatch, review, and fix round. Where I cite a commit, the link is
real and checked. Where I make a judgment, I say it is a judgment. Where I
have no evidence one way or the other, I say that too, because a fair
report about whether a process works has to admit which parts of it were
never really tested.

All commit links are to `github.com/ZoneMinder/zmNinjaNg`.

## Verdict by pillar

Details and evidence follow in sections 3 and 4; this table is the summary.
"Helped" means it produced outcomes a standard single-agent Claude Code
session would probably have missed, with incidents to show for it.

| Pillar | What it adds over standard Claude | Verdict |
|---|---|---|
| Independent review loop (separate reviewer per task, re-review per fix round) | A second context re-derives correctness instead of the author grading their own work | Helped; largest single effect: 10 user-visible defects caught before merge (3.1) |
| Mechanical gates (contract tests, lint ratchet, instruction word budget) | Invariants enforced by failing tests, not by memory or goodwill | Helped; blocked real drift 4+ times, including against the orchestrator (3.2, 3.7) |
| Architecture contracts in AGENTS.project.md | Written invariants quoted in every brief and review | Helped; mostly by prevention, visible as absence of whole defect classes (3.3) |
| Test-first with proven-red regression tests (P2) | A fix's test must be shown failing on pre-fix code | Helped where verifiable; caught 2 tests that could not fail (3.4) |
| Raw-output rule (P6) | Verification reads raw command output, never summaries | Helped; decisive twice (3.5) |
| Ledger and committed phase plans | Progress state survives crashes and restarts | Helped; 3 environment failures recovered cheaply (3.6) |
| Playbooks and domain knowledge | Per-domain facts agents read before working | Mixed; pre-existing playbooks helped, closeout additions unproven (3.8) |
| Brief-driven dispatch | Orchestrator writes the task, implementer builds exactly that | Mixed; propagates orchestrator mistakes with full test coverage (4.1) |
| Multi-agent messaging and lifecycle | Parallelism across ~40 agents | Cost; report delivery, idle noise, and shared-worktree races are framework problems, not rule problems (4.2) |
| Live-server e2e testing | End-to-end checks against a real ZoneMinder | Cost; shared-server flakiness, independent of the framework (4.3) |

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

Final numbers: 77 commits, 297 files changed, +22,025 / -3,555 lines. The
unit suite grew from about 3,273 tests to 3,614. The lint ratchet baseline
ended lower than it started (react-hooks/exhaustive-deps went from 38 at the
branch point to 34 at close). First code commit
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

### 3.2 The lint ratchet (rule C7)

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

- **Settings.** The rule that every coercion lives in
  `mergeProfileSettings` meant the ALL-bucket design needed zero new
  storage code, and the
  live/muted/off migration
  ([`74c65f0`](https://github.com/ZoneMinder/zmNinjaNg/commit/74c65f00))
  had exactly one correct place to put its legacy-boolean conversion.
  Reviewers checked bucket writes on both sides (target written, other
  bucket untouched) because the contract told them which side was which.
- **Sessions.** Written mid-project (phase 1,
  [`93bb7de`](https://github.com/ZoneMinder/zmNinjaNg/commit/93bb7deb))
  with real grep-gates: ApiClient construction confined to four sanctioned
  files, the deleted singleton stays deleted, the reserved marker ids
  (such as the All-Servers id) live only
  beside their brand. Those gates then ran green through 50 more commits
  and caught one real drift attempt: an implementer's test files used raw
  `'__all_profiles__'` string literals, and the gate blocked the commit
  until they imported the constant.
- **Auth tokens.** The single-flight dedup contract shaped the phase 1
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

### 3.4 Test-first with proven-red regression tests (rule P2)

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

### 3.5 Raw-output distrust (rule P6 and the rtk memory)

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

### 3.7 The instruction word-budget gate (rule M-series)

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
- [`agents/project/native.md`](../../../agents/project/native.md) mostly pointed to the Native contract, which
  carried the TLS trust-on-first-use invariant that drove the phase 0
  review finding.

The domain facts *added during* this work (the alarm endpoint being
single-monitor only, cross-server id collisions, ES payload profile
fields, the i18next `{{count}}` reservation, the live-server e2e
degradation pattern) were written into
[`agents/project/domain-context.md`](../../../agents/project/domain-context.md)
at closeout. They did not help this project, because they were learned
here; they can only help future work. I want to be clear about that
distinction: writing them down is following rule M5, but I have no
evidence yet that the M5 pipeline pays off, only that this run *consumed*
several facts recorded by earlier runs (the RTK output warning and the
device e2e manual-only rule both came from memory/playbooks and both
mattered).

One domain rule was discovered too late to be cheap: composite ids.
Monitor and event ids collide across servers as a matter of course, and
six separate defects came from bare-id keys in aggregate code (the
timeline row merge, the popover profile resolution, the filter
cross-selection, the connection keys, the go2rtc cache, the hint
matching). The spec named the risk in prose; nothing enforced it. After
the third incident the `monitorCacheKey` helper became the standard, and
the closeout added an Aggregation contract, but a gate that could check it
mechanically does not exist yet and is the top tracked follow-up. Had the
composite-id rule existed before phase 2, most of the six incidents would
not have happened; this is the clearest case in the project where a
missing rule had a measurable cost.

---

## 4. Where the process cost time, split by cause

The maintainer asked me to separate failures of the rules from failures of
the surrounding framework. On review, most of the friction came from the
framework and from my own plan-writing, not from the rules.

### 4.1 Failures of the process design (the rules' side)

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
recorded in the workflow playbook: the brief file is the reviewer's
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
instead of their own message. Content is intact and verified, but the P5
one-commit-one-change rule was broken by accident twice in one night. The
conclusion: staging by explicit path is not sufficient; either one
committer at a time, or worktree isolation for agents that commit. This
was operator error combined with git's whole-index commit behavior, not a
defect in any written rule, but no written rule prevented it either.

### 4.2 Failures of the framework (not the rules)

These cost real time and none of them are addressable by editing
[AGENTS.md](../../../AGENTS.md). I list them separately because a reading of the session log
that does not make this distinction would attribute all of it to the
process.

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
- **Two agent deaths from environment failures** (host reboot, network
  drop) left half-done worktrees. The recovery worked (section 3.6), but
  the deaths themselves and the fact that an interrupted agent leaves no
  handoff note are framework properties. The ledger compensates for
  them; it does not prevent them.
- **Output-summarizing wrappers** (the rtk tee) hid a suite failure once.
  The project already distrusts them by rule (P6), which is how the
  failure was caught, but the rule exists specifically to defend against
  this piece of tooling.
- **A resumable-agent limitation**: stopped agents cannot be re-messaged
  ("no agent named X is reachable"), so continuing a task after a stop
  means a fresh spawn and re-established context. This shaped the
  keep-reviewers-alive practice above.

### 4.3 Weak spots that are neither rules nor framework

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

**The render-loop selector class recurred five times despite being
caught every time.** The workflow detected each instance but did not
prevent recurrence until the closeout wrote the pattern into the Stores
contract and the testing playbook. Detection worked; prevention did not
exist until the end, and whether the new contract text prevents the next
instance is untested.

---

## 5. Things I cannot fairly judge

- Whether plain test-first (as opposed to the proven-red discipline, which
  I could verify) changed outcomes. Implementers reported failing-first
  consistently, but I cannot distinguish a genuinely test-driven task from
  a well-reported one from where I sit.
- Whether the issue-linkage rule (P1) prevented anything. Every commit
  references [#337](https://github.com/ZoneMinder/zmNinjaNg/issues/337)
  and the PR trail is clean, which has archival value, but
  I saw no incident where the linkage itself caught or prevented a
  mistake. When the maintainer said to stop filing new issues mid-flow,
  folding increments into the umbrella issue worked fine.
- Several rules simply never came under pressure: the one-file-folder
  rule (C5), the merge-without-approval rule (P8), the typo-exemption in
  P1. No violations, no tests of their value either. Absence of incidents
  is consistent with "working silently" and with "irrelevant this run";
  the available evidence cannot distinguish the two.
- The overhead estimate. My best judgment is that workflow mechanics
  (dispatch writing, ledger upkeep, review packaging, nudges) consumed
  fifteen to twenty percent of total effort, but nobody was timing
  individual activities, so treat that as an estimate by the person who
  did the work, not a measurement.

---

## 6. Conclusion

The facts that support the workflow: ten user-visible defects, including
several regressions in the single-profile mode the project promised not
to touch, were caught before merge by reviews the workflow mandated. At
least four of them (the socket-leak triple and the unbootstrapped-profile
omission) would have been hard to reproduce from field reports if they
had shipped. The contracts kept style and architecture consistent across
22,000 lines written by roughly forty separate agent contexts. The ledger
made recovery from a reboot, a network drop, and a LAN outage cheap. The
gates applied to the orchestrator's own commits twice, not only to
implementers'.

The costs: briefs with defects that implementers faithfully built, a
fix-wave budget that concurrency work overran three rounds deep, one
worktree shared by too many committers, and a messaging layer that
required repeated manual workarounds. The first three have recorded fixes
in the workflow files now; the last is a framework problem outside the
reach of rule changes.

My assessment: for this feature, at this scale, with this much
refactoring underneath it, the workflow helped, and the benefit clearly
exceeded the overhead. The caveat is that most of the value came from two
mechanisms, the independent review loop and the mechanical gates. A
future project that keeps those two plus the ledger would keep most of
the benefit with less process.

## 7. Follow-ups this report feeds

1. A mechanical gate for composite ids in aggregate paths, the
   six-incident class (tracked; the Aggregation contract currently says
   "review" honestly instead of overclaiming).
2. The render-loop selector rule and real-store test requirement are now
   in the Stores contract and testing playbook; their effectiveness is
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
   report delivery reliability, stale idle pings from stopped agents, and
   the inability to resume a stopped agent.
