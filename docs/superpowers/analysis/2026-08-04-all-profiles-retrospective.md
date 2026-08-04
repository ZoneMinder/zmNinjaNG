# All Profiles: an honest retrospective of the agent workflow

Written 2026-08-04 by the orchestrating agent at the maintainer's request:
"document fairly and honestly whether the agent workflow we created actually
helped or not." This is that document. Numbers come from git; judgments are
mine and I have tried to argue against myself where the evidence allows.

## What was built

The All Profiles feature: a virtual "All Servers" profile aggregating every
configured ZoneMinder server across the whole app. Prerequisites forced two
deep refactors first: the API-client singleton became a per-profile session
layer, and native TLS trust became a host-keyed fingerprint map. Delivered
over two stacked PRs (#338 foundation, #339 feature), five planned phases
plus a stream of post-close increments from the maintainer's live acceptance
testing (disable toggle, notification overview, multi-connection live
notifications with a live/muted/off control, All-mode Live Activity, and
assorted UX fixes).

Scale: 77 commits, roughly 285 files and +21k/-3.5k lines across both
branches, first code commit 2026-08-02 14:15, feature-complete plus
increments by 2026-08-03 late evening. Wall-clock spans two calendar days
including a maintainer sleep window, one host reboot, one network loss, and
one relocation to a different LAN. Unit suite grew from ~3273 to ~3600
tests; the lint ratchet ended BELOW where it started (exhaustive-deps
38 at the branch point down to 34 at close) despite the volume.

## How it was executed

- Design: brainstorming skill (interactive, ~10 clarifying decisions),
  spec written and committed before any code. Approach chosen explicitly by
  the maintainer: big-bang session migration over an incremental facade.
- Per phase: a written plan with per-task briefs, then subagent-driven
  development — one fresh implementer per task, an independent reviewer per
  task, scoped re-reviews per fix round, a whole-branch Opus review per
  phase, and one consolidated fix wave after each of those.
- Post-close increments used a lighter loop (single implementer + single
  reviewer per increment) but kept the same review bar.
- Roughly 40 subagents dispatched across the effort. Every task-level
  review ran; no code merged unreviewed except two one-line cosmetic edits
  by the orchestrator (a button variant, a card color), each covered by
  existing tests.

## Did the workflow help? Verdict first

Yes, decisively — but not uniformly, and not cheaply. The honest summary:
the review loop was the single highest-value mechanism and paid for itself
many times over; the contracts/gates caught real classes of error
repeatedly; the ledger made three environment failures a non-event. The
costs were real too: reviewer-report delivery was unreliable and cost a
nudge round on most dispatches, my own briefs introduced defects that
implementers faithfully built, and the "one fix wave" rule was violated
twice because reality (a new Critical inside a fix wave) beat the rule.

## What the workflow caught (the case FOR)

The independent-review loop found, before merge, every one of these — none
were caught by the implementing agent's own tests first:

1. Pre-save TLS trust regression (Phase 0, plan-mandated defect — MY brief
   was wrong; the reviewer caught the consequence, the maintainer ruled the
   candidate-override fix).
2. Proactive token refresh silently dead for two whole tasks (Phase 1 C1 —
   the enable guard referenced wiring that would not exist until Task 8).
3. Cross-profile server-map/token bleed for multi-server ZM (Phase 2 I1)
   and the missing per-profile reLogin callbacks (I2).
4. All mode silently omitting every unbootstrapped profile — no data, no
   error strip (Phase 2 C1, the exact failure the partial-failure design
   existed to prevent).
5. Blank MJPEG player on the deep route that was the headline of Phase 3
   (one missing prop; the e2e asserted only the URL).
6. Composite-token leak into event prev/next; the montage deep link
   clobbered by a settings-sync effect (both introduced BY a fix wave and
   caught by the scoped re-review of that wave).
7. A notification-history render loop that crashes on the first
   notification in ANY mode (post-close Critical; unit tests could not see
   it because the store mock bypassed useSyncExternalStore — the reviewer
   reproduced against the real store).
8. A single-mode profile-switch socket leak, an auto-connect deadlock, and
   a backoff-defeat regression, each introduced by the previous round's fix
   in the multi-connection work — three consecutive scoped re-reviews each
   caught the new defect the prior fix created.
9. Live Activity's watch-cap re-slice evicting an on-screen alarming tile
   outside the dwell window (the refs #313 churn class through a new door).

Recurring classes the gates caught mechanically:
- C7 lint ratchet: two attempted baseline raises, both justified with
  "existing code does it" — the exact rationalization the rule names. One
  was avoidable and fixed (and ended BELOW baseline); one survived an
  empirical three-variant attempt and stands as a documented hand-raise.
  The rule worked both ways: it forced the fight, and its escape hatch
  covered the genuine case.
- The render-loop selector class (fresh objects inside zustand selectors)
  bit FIVE times across the branch. After the second, reviews checked for
  it by name; after the third, real-store regression tests became the
  demanded standard. The workflow turned a recurring bug into a checklist
  item — but note honestly: the workflow also failed to prevent
  recurrence, it only caught each instance.
- Localization ×5, kebab testids, ErrorBanner-only error UI, constants
  placement: near-zero violations reached review because the briefs quoted
  the contracts. The one translation near-miss (a sed that broke 15
  pluralized strings across 5 locales) was caught by the implementer
  reading raw test output — a practice the project rules mandate (P6/rtk
  distrust) and which paid off exactly as designed.

Environment resilience: a host reboot killed one implementer mid-task
(~20 uncommitted files), a network loss killed another, and a LAN move
stranded e2e for hours. The ledger + git recovered all three with zero
lost work and zero re-done tasks. The deferred-e2e playbook (commit
locally, hold push, poll for the LAN, run acceptance later) worked
unmodified. This is the strongest evidence for the ledger discipline: the
recovery cost was minutes, not sessions.

Bisect-verified honesty: when the full e2e suite showed 5 failures in the
area the fix waves had just touched, the workflow's answer was a
pre-branch-baseline bisect, which proved all 5 pre-existing (shared live
demo server degradation). Without that discipline the natural move would
have been to "fix" tests that were never broken by us.

## What the workflow cost or got wrong (the case AGAINST)

1. MY plan briefs shipped defects that implementers faithfully built.
   The Phase 0 brief mandated the trust-union call pattern that broke
   pre-save onboarding; it also used a wrong settings field name. The
   Phase 1 plan's ALL_PROFILES_ID placement was unbuildable (a real import
   cycle). Task-brief extraction (scripts/task-brief) also lost dispatch
   context: in Phase 3 Task 7 the reviewer flagged "undisclosed scope
   creep" for work MY dispatch had explicitly ordered — the brief file did
   not contain the dispatch prompt, and the reviewer only saw the brief.
   Lesson recorded: the brief must be the single source of requirements;
   anything added in the dispatch prose is invisible to reviewers.
2. Subagent report delivery was unreliable. Roughly a third of reviewer
   completions arrived as idle notifications with no report; each needed a
   "resend via SendMessage" nudge, and subagents' sends to "main" errored
   in some sessions ("you are the main conversation"), requiring a by-name
   fallback. Pure overhead, maybe 10-15 exchanges across the effort.
   Memory now instructs every dispatch to demand SendMessage delivery with
   the by-name fallback, which stabilized it late.
3. The one-fix-wave rule lost to reality twice. Both whole-branch fix
   waves introduced at least one new Critical/Important, and parking a
   fresh Critical (a montage deep-link regression for single-profile
   users; later a socket-per-drop backoff defeat) was worse than a
   documented extra round. I broke the rule deliberately both times, with
   ledger entries. The rule's intent (no endless churn) is right; its
   letter assumes fix waves do not create Criticals, which large waves do.
   The multi-connection increment needed FOUR rounds; each was justified by
   a genuinely new defect, and each new defect was created by the previous
   fix. That is not review churn — that is what concurrency changes cost.
4. Review depth was uneven with model tier. Sonnet task reviews were good
   at contracts and mechanics; the Opus reviews found the integration and
   concurrency defects sonnet passes missed (the socket leak, the
   reschedule deadlock, the tz-naive buckets; the resident-cap dwell
   bypass likewise came from an Opus TASK review, so the tier mattered
   more than the scope). Where I economized on the reviewer tier for
   concurrency-heavy diffs, defects survived one extra round before the
   Opus pass caught them. The cost model should have keyed reviewer tier
   to diff RISK, not diff size, earlier than it did.
5. e2e was the weakest leg. One shared live ZM server, fullyParallel
   workers, content drift: 14 flaky-then-pass on a bad run, 5 permanently
   failing scenarios (bisect-proven pre-existing) that now ride as a
   documented tolerated set (#342). Two of my own new scenarios were
   initially timing-fragile and needed settle/poll rewrites after their
   first live run. The unit/component suites carried the real verification
   weight; e2e mostly proved wiring and caught two test bugs of its own
   making. Live websockets and alarm states were declared un-e2e-able and
   covered by unit tests only — true, but it means the most concurrent
   code has the least end-to-end evidence.
6. Orchestration overhead was nonzero: ~40 dispatch prompts, each
   hand-written with context, plus ledger bookkeeping, package scripts,
   and stale idle-notification noise from stopped agents (dozens of
   messages). I judge the overhead at perhaps 15-20% of total effort.
   Against the defect list above it was clearly bought well, but a solo
   agent WITHOUT reviews would have shipped several of those Criticals.
7. Two rules I applied inconsistently: I deleted the SDD workspace after
   each phase per the skill, then twice needed its diffs again and had to
   recreate packages; and I stopped agents promptly per memory, which
   twice killed a reviewer I wanted for the scoped re-review (context
   lost, fresh spawn needed). Prompt-kill and keep-for-re-review are in
   tension; keeping the reviewer alive until its re-review is the better
   default and is what I converged on.

## Rules and contracts: which earned their keep

- P2 failing-test-first: the discriminating-test discipline (prove red,
  then green) caught two would-be-vacuous regression tests — one that
  passed on both old and new code (reference-stability), one that would
  have masked the notification render loop. The demand "prove your test
  fails against the pre-fix code" became the single most-repeated
  instruction and repeatedly earned it.
- The Settings/Sessions/Polling/Query-UI/Localization contracts: quoted in
  every brief; violations near zero at review. The Sessions contract's
  grep-gates (sanctioned ApiClient constructors, sentinel locality) held
  through 77 commits without drift.
- P6 raw-output distrust: caught the rtk-summarized "0 failed" that hid a
  suite-level collection error, and the sed locale breakage. Twice
  decisive.
- The zero-behavior-change acceptance (full e2e green with no e2e edits)
  for the Phase 1 big-bang: it worked — the riskiest refactor of the
  effort produced no observed single-profile regression, ever. The
  maintainer's big-bang choice was vindicated by this gate existing.
- Two-tier preferences (data prefs per profile, view prefs in the ALL
  bucket): zero ambiguity across ~15 later feature decisions; every new
  setting had an obvious home. The single best DESIGN decision of the
  spec against "confusion later".
- The composite-id rule (profileId:monitorId) was discovered, not
  designed: monitor/event id collisions across servers caused SIX distinct
  findings before the helper became standard. The spec named the risk but
  no gate enforced it; a lint/contract for "no bare monitor/event id keys
  in aggregate paths" would have prevented four of the six. That is the
  clearest miss in the original design.

## Time accounting (approximate, from commit timestamps and session flow)

- Design + spec + plans: ~3h (interactive).
- Phase 0+1 (TLS + session layer): ~6h including reviews and fix rounds.
- Phase 2 (All mode + monitors): ~5h.
- Phase 3 (events/timeline/routes/notifications): ~8h including a reboot
  recovery, a LAN outage, and the deferred-e2e window.
- Phase 4 (montage/dashboard/pickers/assistant): ~6h.
- Post-close increments (disable, overview, multi-connection notifications
  live/muted/off, Live Activity, UX fixes): ~8h, review-heavy — the
  multi-connection work alone took four review rounds.
- Overhead attributable to workflow mechanics (nudges, ledger, packaging,
  stale pings): perhaps 3-4h spread across everything.

## Bottom line

The workflow's core loop — fresh implementer, independent reviewer,
prove-it-fails tests, scoped re-review, phase-level deep review — caught
at least nine defects that would have shipped as user-visible breakage,
including three single-mode regressions in an effort whose first promise
was "zero single-mode change". No solo pass would plausibly have caught
the socket-leak/deadlock/backoff triple or the render-loop family. The
contracts turned project style into mechanical checks that held under ~21k
new lines. The ledger made real-world interruptions cheap.

The same workflow generated real friction: defective briefs propagate
fast precisely because implementers follow them faithfully; report
delivery needed babysitting; fix waves on complex subsystems create new
defects at a rate the one-wave rule does not anticipate; and e2e is the
one gate whose evidence is weakest exactly where the code is most
concurrent. None of these outweigh the catch list. On this feature, at
this scale, the workflow was worth its cost — roughly a fifth of the
effort spent on process, in exchange for a defect class list that reads
like a production postmortem that never happened.

## Follow-ups this retrospective feeds (see workflow-file changes landed
alongside it)

1. Composite-id gate for aggregate paths (the six-findings class).
2. Render-loop selector rule + real-store test requirement as a contract,
   not tribal knowledge.
3. Brief-is-the-contract: dispatch prose must be folded into the brief
   file before dispatch, or reviewers judge against the wrong document.
4. Reviewer tier keyed to risk (concurrency/token/native) not size.
5. Keep task reviewers alive until their scoped re-review completes.
6. #341 closed by the Live Activity work; #342 (e2e infra) remains the
   standing debt with an expiry.

## Addendum: the closing session (written after the final review)

The last hours added evidence in both columns and are worth recording
separately because they happened AFTER the retrospective's first draft
and partially tested its own claims.

- The Live Activity increment (the last spec gap) went through three
  review rounds. The task-level Opus review caught a cap-re-slice dwell
  bypass (the refs #313 churn class through a fourth eviction channel)
  and, in round 2, a wrong-profile settings write reachable in PLAIN
  single mode from a mount-time state snapshot - the tenth
  single-mode-regression catch of the effort, on its very last feature.
  The prescribed fix (a derived value with no state write-back) was
  verified loop-free from the emitting component's side, not just the
  consumer's. The pattern held to the end: implementers ship plausible
  code; discriminating reviews plus proven-red regression tests find
  what plausibility hides.
- The shared-worktree index race bit BOTH directions in one night: an
  implementer's commit swept my staged doc files (caught, soft-reset,
  recovered), and later MY one-line trim commit swept the docs agent's
  four staged files (content correct, commit message now mislabeled -
  left unamended because force-pushing a shared branch mid-work is the
  worse failure). Lesson recorded in the workflow playbook: one worktree,
  one committer at a time, stage-by-explicit-path is necessary but NOT
  sufficient - git commit takes the whole index.
- The instruction-file word-budget gate fired on my own contract
  additions, twice, and forced ~40 words of compression before the new
  contracts could land. The file now sits at its budget exactly. The
  M-rules were applied to the orchestrator by the orchestrator's own
  gates - which is precisely the property that makes them trustworthy.
- The review of my closeout docs commit found a real M1 violation I had
  just written (a Gate line claiming mechanization the gate does not
  perform) plus two factual errors in this retrospective's first draft
  (ratchet figures; a review-tier misattribution that inflated my own
  argument). All corrected in 32f7c03/069cada. A retrospective that had
  to be fact-checked by the process it evaluates, and failed twice, is
  itself a data point for that process.

Final tallies at close: 27 commits on the foundation branch + 50 on the
feature branch (77 total), 297 files, +22,025/-3,555 lines, unit suite
at 3,614 tests, lint ratchet 38 at branch point to 34 at close, both
PRs (#338, #339) pushed and mergeable, working tree clean. Every spec
UX line delivered including Live Activity; #342 (e2e infra) is the one
standing debt.
