---
name: fable-review
description: Use when asked for a full codebase review, health check, quality audit, or scorecard of this repo, or for a "fable review" / multi-pillar review whose output another agent will execute. Runs only on Fable; produces a scored, evidence-backed report at docs/superpowers/analysis/. Triggers on "fable review", "review the codebase", "score the repo", "audit code health".
---

# Fable Codebase Review

## Overview

A scored, multi-pillar codebase review whose output is a report another
agent (Opus) executes without re-deriving anything. The pillars and the
report shape come from the first run of this review (issue #217, PR #218,
overall 7.5 to 8.1); the rules below are what that run and its two
follow-up reviews proved necessary.

**Core principle: every finding was confirmed by reading the file it
cites. A grep hit is a lead, not a finding, and a pillar score with no
evidence under it is an opinion that does not get a number.**

Second principle: the report is executed by an agent that cannot see this
session. Anything a finding leaves implicit - the fix, the verification,
the risk, the reason a nearby thing must not change - is work the executor
will get wrong.

## Preconditions (check both before anything else)

### Clean context

The review must start from a clean context. A session that has already
done implementation work carries the assumptions it made while working,
and it will grade its own output: gates it stopped checking read as
green, code it wrote reads as idiomatic, and drift it introduced becomes
invisible. Re-running these checks from a fresh context is the point of
the review.

If this session already holds prior work - edits, debugging, a long
conversation, or anything beyond the invocation itself - **stop** and say:

> This review needs a clean context. Start a fresh session (`/clear`, or
> `claude -p "/fable-review"` from a new shell) on Fable, then run
> `/fable-review` there.

Pillar agents inherit this: each gets a fresh context and a written brief.
Never paste session history into a dispatch.

### Model

This review runs on Fable only. Fable's judgment across a whole
repository is the deliverable; the orchestrator's model bounds everything
under it (see Orchestration in `agents/generic/claude-workflows.md`).

1. Your own system prompt names the model you are running as.
2. If that name is not Fable (model id `claude-fable-5`), **stop
   immediately**. Read nothing, dispatch nothing, write nothing.
3. Say exactly this and end the turn:

   > This review runs on Fable. You are on <model name>. Switch with
   > `/model` (pick Fable 5), then run `/fable-review` again.

Do not work around the gate: not by dispatching Fable subagents under a
different orchestrator, not by "starting the easy parts" first, not by
offering a lighter review instead. `.claude/settings.json` pins this repo
to Opus by default, so hitting this gate is the normal case, and switching
is the user's call.

## Procedure

1. **Read the instruction system first.** `AGENTS.md`,
   `AGENTS.project.md`, every file in `agents/project/` and
   `agents/generic/`. Pillar 3 scores adherence to those contracts, and
   the domain playbook lists approaches that already failed here - a
   review that recommends one of them is worse than no review.
2. **Record scale and state.** File and LOC counts for `app/src/`
   (prod vs test split), native shells, `docs/`, workflows. Name what you
   excluded. Record `git status` and `git branch --show-current`; a dirty
   working tree changes what the executor may commit.
3. **Run the gates bare.** `npm run gates` from `app/`, plus
   `npx madge --circular` style structural probes as needed. Never pipe a
   gate into a filter (the pipeline reports the filter's exit status;
   that shipped a red commit here once). Record raw counts and quote
   failures verbatim.
4. **Dispatch one read-only agent per pillar, all in one message**, each
   on Fable (`model: "fable"`). Each brief carries: the pillar definition
   from the table below, the evidence rules, the finding fields, its
   output path under the scratchpad directory, and the instruction to
   report via SendMessage to "main". Agents read and probe only - no
   edits, no commits. Stop each agent as soon as its report is verified.
5. **Verify before publishing.** Re-read the cited source for every
   damning or load-bearing claim yourself. Duplication and dead-code
   claims are wrong often enough that an unverified one belongs nowhere
   near a score. A claim you cannot confirm is dropped, not softened.
6. **Score, rank, write.** One decimal per pillar, an overall, then the
   phased execution plan. Rank by risk reduced per unit of effort, not by
   pillar order.

## The pillars

| # | Pillar | Scores what | Look at |
|---|---|---|---|
| 1 | Code clarity | Idiom consistency, unnamed state machines, dead ternaries, IIFE-in-JSX, comments that explain why | Largest components, hooks with paired raw/wrapped setters |
| 2 | DRY and reuse | Real cross-file duplication (verified by hand), under-adopted shared components | Page scaffolding, error banners, empty states, control wiring |
| 3 | Contract and rule adherence | Every contract in `AGENTS.project.md` (Owns/Path/Never/Gate) plus the AGENTS.md tiers, measured by counts not vibes | `app/src/tests/agents-contracts.test.ts` and the paths each contract names |
| 4 | Architecture and modularity | Dependency direction, cycles, query-key discipline, persistence durability, folder shape | `app/src/tests/no-circular-deps.test.ts`, `lib/query/`, stores vs services |
| 5 | Test quality and automation trust | What the suite would catch: assertion-free tests, conditional-pass e2e steps, fixed sleeps, presence-only assertions, untested risky modules | `app/tests/**/*.steps.ts`, coverage of `services/`, `lib/security/` |
| 6 | Runtime performance | Hot paths, whole-store subscriptions, per-render allocation, canvas reallocation, stream teardown | Montage, timeline canvas, event list, zustand selectors |
| 7 | Native platform integration | Session/delegate lifetimes, iOS/Android parity, main-thread discipline, permission surface, SDK currency | `app/ios/`, `app/android/`, `app/electron/` |
| 8 | Accessibility and UX robustness | Offline behavior, reduced motion, contrast, touch targets, accessible names, keyboard and TV reachability | `lint:a11y` output, `index.css` tokens, icon-only buttons |
| 9 | Build, CI, dependency health | Which gates are hard vs advisory, hooks, PR gating, dead scripts, gitignore claims that do not match reality | `.github/workflows/`, root and `app/` package.json, husky |
| 10 | Documentation and handover | Accuracy over volume: spot-verify code-citing claims against source | `docs/developer-guide/call-flows.rst`, user guide gaps |
| 11 | Error handling and trust boundaries | I1/I2: validation of server responses, user input and IPC; recovery paths on destructive operations; swallowed errors; error-class misdetection (`DOMException` is not an `Error`) | Validators, delete/download paths, `catch` bodies |
| 12 | Security | Secrets handling, token storage and logging, injection sinks, TLS trust decisions | Ask the maintainer first; the first run skipped this by instruction. If skipped, say so in the report and score it as not assessed, never 0 |

Add a pillar when the repo grows a surface none of these covers, and say
in the report why it was added. Drop one that does not apply, with a
reason; a dropped pillar is not a zero.

## Evidence rules

- Cite `file.ts:123` for anything the reader would open, and name the
  symbol next to it. Line numbers rot within hours on an active branch;
  the symbol is what survives.
- Quote the shortest decisive line of any output. Never paste a log.
- Distinguish confirmed from theoretical. "WKWebView may evict
  localStorage" with no observed incident is labeled as such, and it
  ranks below anything a user has actually hit.
- Deliberate simplifications documented in the domain playbook or a
  `ponytail:` comment are not findings. Contract text beats rediscovering
  an invariant from code; a code/contract mismatch is itself a finding,
  routed to the self-improvement protocol.
- Verify effort estimates against the real site count. "Kill the
  conditional-pass e2e steps" reads as small and is not: it turns green
  scenarios red, because they were hiding gaps.

## Finding fields

Every finding in the report carries all of these. The executing agent has
no session context; a missing field becomes a guess.

| Field | Content |
|---|---|
| ID | `P<pillar>-<n>`, stable, referenced by the phase plan |
| Severity | HIGH / MED / LOW by user-visible impact, not by how odd the code looks |
| Site | `file:line` plus symbol name, one line per site if several |
| What is wrong | The defect, stated plainly |
| Why it matters | The failure a user or contributor would see |
| Fix | Concrete enough to start: the pattern to follow and the existing example of it in this repo |
| Verification | Which gate, test, or device pass proves the fix. New behavior needs a test proven red against the pre-fix code (P2) |
| Effort | S / M / L, justified by site count |
| Risk | What the fix could break, and whether it is verifiable in CI or device-only |
| Contracts | Rule and contract IDs implicated, never copied text |

## Report

Write to `docs/superpowers/analysis/YYYY-MM-DD-fable-review.md`. It is
documentation: `agents/project/documentation.md` applies in full - plain
headings, no superlatives, no invented shorthand, depth over compression.

Sections, in order:

1. **Header** - date, reviewer model, scope, what was excluded, what was
   skipped by instruction.
2. **Scorecard** - one row per pillar: score, one-line verdict, then the
   overall.
3. **Gates** - command, result, raw counts, failures verbatim.
4. **Cross-cutting themes** - two to four themes that explain most of the
   lost points. This is what the maintainer reads first.
5. **One section per pillar** - `Pillar N: name (X/10)`, then strengths
   verified (not assumed), then numbered findings with the fields above,
   then **Path to 10/10** split into *worth it* and *not worth it*. The
   *not worth it* half is load-bearing: without it the executor churns
   through mechanical work that buys nothing.
6. **Non-findings** - things that look wrong and must stay. Every
   do-not-retry from the domain playbook that touches reviewed code goes
   here explicitly.
7. **Phased execution plan** - ordered by risk reduced per effort, each
   item naming its finding IDs. Enforcement and cheap confirmed bugs
   first; large refactors of fragile working code last or deferred.
   Sequencing warnings belong on the item ("gate CI against the tests as
   they are, then harden them behind it"). Batch device-only items into
   one session.
8. **Notes for the executing agent** - per-commit gates to run, issue and
   commit rules (P1, P2, P5), native build-number handling, and anything
   that must not be merged, deleted, or re-attempted.

Then post the report location and the scorecard in the session, and offer
to open the tracking issue. Do not open issues or push branches unasked.

## Common mistakes

| Mistake | Fix |
|---|---|
| Proceeding on a non-Fable model | Stop at the gate. It is the first instruction for a reason |
| Reporting grep counts as findings | Open the file. The first run's credibility came from spot-verified claims |
| Recommending an approach the domain playbook records as failed | Read `agents/project/domain-context.md` before writing any Path to 10/10 |
| Proposing deletion of an empty hook point | An unimplemented feature is a missing feature: file it, do not silently remove the branch |
| Bundling enforcement with the work it would newly fail | Gate first against current behavior, harden after |
| Sizing a multi-site cleanup as S | Count the sites, then estimate |
| Scoring test quality by test count | Score by what the suite would catch; name one plausible bug it would miss |
| Ranking theoretical risks alongside observed ones | Label the evidence, rank by it |
| Omitting the non-findings section | The executor will "fix" a deliberate design and ship a regression |
| Leaving native items unmarked | Say device-pass-required on every one; CI cannot verify them |
