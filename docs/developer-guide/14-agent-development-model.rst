Agent development model
=======================


Most code in this repository is written by AI agents, and the diffs are not
line-reviewed by a person. This chapter explains why that works here, what
enforces correctness instead, and where a human still
reviews deliberately.

Scope, platforms, and release guardrails
----------------------------------------

One codebase ships everywhere zmNinjaNg runs: iOS and
Android through Capacitor, macOS, Windows, and Linux through Electron, and
the browser directly. 

zmNinjaNg is the front of of a three-part ecosystem, all developed
under the model this chapter describes:

- **ZoneMinder** records from the cameras and exposes the API and
  streaming daemon everything else talks to.
- **zmesNg** (`docs <https://zmeventnotificationng.readthedocs.io/en/latest/>`__),
  successor to zmeventnotification, watches ZoneMinder for new events,
  runs AI/ML inferencing on them, and pushes the results out.
- **pyzmNg** (`docs <https://pyzmng.readthedocs.io/en/latest/>`__) is the Python ZoneMinder library zmesNg builds on,
  wrapping the API and the detection pipeline.

The app ships an assistant that answers questions about the user's
cameras and events by calling tools against their server, on the
user's choice of backend: their own **Ollama** server, on-device
**WebLLM**, or **Apple Foundation Models**. Language models fabricate
where code merely crashes, so this subsystem carries extra guardrails:
the **Assistant tool loop contract** gates whether a turn may answer
at all, and two playbooks
(`data-integrity <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/data-integrity.md>`__,
`llm-models <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/llm-models.md>`__)
carry the schema rules and the measured model-behavior facts.

That breadth is the reason the guardrails exist: a change to a shared
component can misbehave on **five platforms at once**, and no single
machine can verify all of them. Platform divergence is therefore written
down where agents will find it (the Native contract, the native playbook,
the platform quirks in domain-context), web e2e runs in CI, and device
e2e (Android emulator, iOS simulator and tablet) is run manually from
scripts, never by agents.

Releases follow the same posture. Android and desktop binaries are built
by the GitHub workflows, not on a laptop: the ``build-*`` workflows are
dispatched manually with a version number, and pushing a ``zmNinjaNg-*``
tag drives the release workflow that publishes from those artifacts. iOS
is the exception: it builds locally through Xcode because of signing and
App Store submission, and there is no iOS build workflow. Native build numbers change only in a deliberate ``chore:``
commit, enforced by the version guard in CI, and test builds reuse the
existing workflows rather than growing new ones. Contributions are held
to the same standard as the maintainer's own work: the rules and gates in
this chapter, plus a code review before the PR.

Every workflow, and what fires it:

.. list-table::
   :header-rows: 1
   :widths: 28 30 42

   * - Workflow
     - Fires on
     - Purpose
   * - ``ci.yml``
     - every PR, push to main
     - version guard, lints, build, unit tests (full-history checkout for
       the evidence gate), web e2e
   * - ``label-guard.yml``
     - PR open/sync/label events
     - requires or auto-assigns the ``core``/``refactor`` label
   * - ``claude.yml``
     - @claude mention on issues and PRs
     - summons an agent into the thread
   * - ``build-android/-macos/-windows/-linux-*.yml``, ``build-all.yml``
     - manual dispatch with a version
     - per-platform release binaries
   * - ``create-release.yml``
     - ``zmNinjaNg-*`` tag push
     - publishes the GitHub release from built artifacts
   * - ``test.yml``
     - release published
     - re-runs unit tests with coverage against the released code
   * - ``deploy-pages.yml``
     - push to main touching ``site/**``
     - deploys the project site
   * - ``auto-close-low-quality-issues.yml``, ``moderate-issue-spam.yml``
     - issue events
     - agent-based issue triage

Moving from code review to constraint enforcement and design review
-------------------------------------------------------------------

Reading every generated diff stopped scaling early, and it was never good
review to begin with: a person skimming a few hundred generated lines
misses more than a failing test does. The principles that replaced it:

- **Constraints instead of inspection.** Every rule an agent has to
  follow is written down; every rule a script can check has a script
  checking it; when something breaks that no rule covered, the fix has to
  include the rule that would have covered it. The maintainer states what
  should happen (a bug, a feature, an issue number), an agent does the
  work, and the gates decide whether it lands.
- **Design gets the human attention that diffs used to.** Feature work
  starts as a short design doc saying what is being built and why, and
  the maintainer approves that before implementation; the approved specs
  and plans are committed under
  `docs/superpowers/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers>`__.
  Reviewing a half-page of intent catches wrong-direction work earlier
  and cheaper than reviewing the thousand lines it would have become.
- **Code review happens offline, at milestones.** Instead of per-diff
  review, the scorecard and history-mining skills run against the whole
  codebase roughly monthly (both described below), and their findings
  become issues, gates, and playbook entries.
- **Models check each other.** Reviews are dispatched to an agent that
  did not write the code, and at milestones different frontier models
  re-verify each other's claims, gates re-run included.
  `Issue #217 <https://github.com/ZoneMinder/zmNinjaNg/issues/217#issuecomment-4882243836>`__
  has a worked example: Fable re-reviewing a 15-commit delta that Opus
  had reviewed, four verification agents plus a fresh gate run.
- **Forced documentation is how the human keeps learning.** Rule P10
  makes every new API, component, hook, or utility update the developer
  docs and call flows, and the documentation playbook requires that
  writing to teach (React explained where a chapter first relies on it,
  flows traced through real user actions). This is not bureaucracy; it is
  the maintainer's replacement for reading diffs. In a codebase agents
  write, understanding comes from reviewing designs before the code
  exists and reading the docs the code is forced to produce after, which
  is why this guide exists at all (see :doc:`01-introduction`).
- **Knowledge stays in the repository.** Session memory cannot be seen by
  other agents, other contributors, or CI, and dies with the machine.
  A revert or a string of fixes to one file is a lesson already paid for.
  The facts in
  `domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
  came from sweeping agent memory and the full commit history once; rule
  M5 requires the same of every future session.
- **Rules organize by concern, not by layer.** No frontend or backend
  rulebook: a contract owns its subsystem's invariant whichever layer it
  sits in, platform divergence lives in the native playbook and
  domain-context, and the dev guide teaches the frameworks. A layer
  playbook gets created only when a recurring failure class arrives with
  no home in the current cut.
- **Agent count is a cost, not evidence of rigor.** Every dispatch
  re-reads context, and reviews of mechanical work here found nothing the
  gates had not already proven. Review ceremony scales with a change's
  risk, delegation does not: independent review is reserved for judgment
  work plus one whole-branch review before every PR, while a small
  bounded change relies on its gates.

Rules, gates, and practices
---------------------------

This guide uses three terms with specific meanings.

A **rule** is a binding statement in
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
or
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__.
Rules in the core file carry stable tier IDs (I for invariants, P for
process, C for code, M for meta rules about the instruction files
themselves), and each states what must hold, why, and where it is
enforced. Rules change through one path: the PR that hit a problem
proposes the rule change, and the maintainer merges or rejects it. A
**contract** is a rule scoped to one subsystem. Each contract names what
the subsystem owns, the sanctioned path through it, the bypasses that are
always bugs, and the gate that checks it.

A **gate** is a script that enforces a rule. Rule M1 requires one for any
rule a script could check, added in the same change as the rule; an audit
here once found every ungated rule violated while every gated rule held,
which is the entire argument. Current gates: the unit suite, three
blocking lints, the ratcheted lint baseline, a CI
`label guard <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/label-guard.yml>`__
that requires a ``core`` or ``refactor`` label on every PR (derived from
commit types when absent), and
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__,
which checks the instruction files themselves: symbols named in contracts
exist in the code, the core file contains no project names, the
instruction files stay under a word budget, commit hashes cited as
evidence exist in history, the knowledge files contain no emails or IP
addresses, and rule IDs cited in this guide resolve. Branch protection on ``main`` requires every one of these
checks, so a PR cannot merge before they pass; merges queue with GitHub
auto-merge and land when the checks go green. Rule M2 covers the
gates' own blind spot: a number a gate reports has to describe the thing
it claims to measure, because a gate that measures the wrong input passes
forever.

A **practice** is advisory guidance in the playbooks under
`agents/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents>`__:
how to structure multi-agent work, when review ceremony is worth it, which
model tier fits which kind of task, and the accumulated domain facts.
Practices cite evidence (commit hashes, a validation date) instead of
carrying IDs, load only when the work touches their area, and lose to
rules on any conflict. A practice becomes a rule when ignoring it starts
breaking things. A rule that turns out to be wrong leaves the same way it
arrived, through a PR.

How the pieces fit
------------------

.. mermaid::

   graph TD
     CL["CLAUDE.md<br/>(Claude Code shim)"] --> AG["AGENTS.md<br/>rules I / P / C / M"]
     CL --> AP["AGENTS.project.md<br/>14 contracts + project rules"]
     AG -. "read before any work" .-> AP
     AP -- "table: read for your area" --> PP["agents/project/<br/>testing, docs, native,<br/>data-integrity, domain-context"]
     CL -- "multi-agent work" --> GP["agents/generic/<br/>claude-workflows.md"]
     AG === GATE["agents-contracts.test.ts<br/>symbols exist, purity, word budget,<br/>evidence hashes, privacy, doc refs, headings"]
     AP === GATE
     PP === GATE
     PR["every PR"] === LG["label-guard.yml<br/>core / refactor label"]
     PR === CI["ci.yml<br/>tests, lints, build"]
     GATE --> CI
     FAIL["breakage or review finding"] -- "fix PR proposes rule + gate<br/>(self-improvement protocol)" --> AG
     FAIL -- "durable fact (M5)" --> PP

Solid arrows are load order in a session; the double lines are
enforcement; the bottom edges are the feedback loop that grows the files.

`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
at the repo root is the portable core; it contains nothing specific to
zmNinjaNg.
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__
carries the fourteen architecture contracts and the project rules. The
point of the contracts is that an agent changing, say, settings behavior
reads the Settings contract instead of rediscovering the design from
source.

`agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__
holds the area playbooks (testing, documentation, native, data integrity)
and ``domain-context.md``, the verified project facts: API quirks,
platform behavior, approaches that were tried and reverted.
`agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
holds workflow guidance that is not project-specific. Playbooks are read
when the work touches their area, so they can afford detail that the
always-loaded files cannot.

Enforcement lives in ``app/src/tests/`` and the CI workflows. Covering
gates run before every commit; the full battery runs before a push or PR
(rule P3).

Review still happens on every change, done by agents rather than the
maintainer. The workflow in
`claude-workflows.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__
pairs an implementing agent with an independent reviewing agent for work
that involves judgment, and one whole-branch review runs before every PR.
CI runs the full gate suite on every push. The
`claude.yml <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/claude.yml>`__
workflow lets the maintainer bring an agent into any issue or PR by
mentioning it.

When something breaks despite all of this, the fix is required to carry
more than the patch: the same PR proposes the instruction change that
would have prevented the break (with its gate, per M1), and any durable
fact learned along the way goes into ``domain-context.md`` (per M5). The
maintainer ends up reviewing small instruction diffs instead of large code
diffs, and each failure gets absorbed once.

A contract, end to end
----------------------

A concrete walk-through, using the Polling contract. In
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__
it reads:

.. code-block:: markdown

   ### Polling
   Owns: every recurring refresh interval.
   Path: `useBandwidthSettings` / `getBandwidthSettings` (`app/src/hooks/useBandwidthSettings.ts`).
   Never: literal interval values; users tune bandwidth globally.
   Gate: `app/src/tests/agents-contracts.test.ts`; review.

That block is the *instruction*. An agent asked to add, say, a
refresh-every-30-seconds feature reads it and knows three things without
opening any source: recurring intervals belong to this subsystem, the only
sanctioned way to get one is the two named functions, and hardcoding
``30000`` is a bug even if it works.

The *gate* is one TypeScript test file,
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__,
which runs with the normal unit suite. For this contract it parses the
block, pulls every backticked token out of the ``Path:`` and ``Gate:``
lines, and checks each one against reality: tokens containing a slash must
exist as files (``app/src/hooks/useBandwidthSettings.ts``), bare tokens
must appear as words somewhere in ``app/src``
(``useBandwidthSettings``, ``getBandwidthSettings``). Rename or delete the
hook without updating the contract and the suite fails with
``Polling: symbol useBandwidthSettings not found in app/src`` until the
contract matches the code again. That is the property the contracts
depend on: they cannot silently rot, so an agent can trust them instead of
re-deriving the design.

What the gate cannot check, review covers: nothing mechanical proves a new
``setInterval(30000)`` violates the ``Never:`` line, which is why the
``Gate:`` field says ``review`` too, and why review ceremony concentrates
on judgment. The same file carries the checks on the instruction system
itself (core purity, word budget, evidence hashes, privacy, doc
references, headings), so the files this chapter describes are gated by
the same mechanism they document.

Monthly scorecard review
------------------------

Gates only catch what they were built to catch. Drift is whatever nobody
wrote a gate for yet: duplication spreading across files, tests that pass
without asserting much, a convention the code quietly stopped following.
The first of the two deliberate human reviews covers this: roughly once a
month, a scorecard review of the whole codebase. Also, models tend to forget 
over long sessions. There have been many situations where gates are clear but 
the model forgot.

The scorecard scores twelve weighted pillars (architecture, test quality,
code quality, DRY, type safety, error handling, security, convention
self-consistency, performance, documentation, tooling, accessibility and
i18n). Two constraints keep it honest. A pillar only gets a number if a
command was actually run to produce the evidence, and test quality is
scored by what the suite would catch (assertion density, failure paths,
boundary cases, mock saturation), never by test count. One useful probe:
try to name a plausible bug the suite would miss; if that takes under a
minute, the testing score is inflated. Output ends in a ranked fix list.

Ranked fixes become issues, and issues become agent work.
`Issue #281 <https://github.com/ZoneMinder/zmNinjaNg/issues/281>`__ shows
the full cycle: a scorecard run found React correctness gaps, coverage
measured against the wrong input, and import cycles; the hardening work
landed under that issue; and several of its checks (the cycle gate, the
scoped lint configs) stayed behind as permanent gates. The next review
does not need to look for those problems again.

Mining history for lessons
--------------------------

The second deliberate review audits the instruction files against the
commit history. The per-PR protocol only fires when someone notices in the
moment that a lesson was learned; the
`mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__
skill catches what nobody noticed. It walks the history looking at
reverts (something was tried and did not work, which is worth writing
down), repeated fixes to the same subsystem (one misunderstanding
surfacing over and over), and fixes that an existing gate should have
caught. It reports candidate ``domain-context.md`` entries and candidate
contracts, each with the commit hashes that justify it. Its first run over
this repo's 2254 commits produced two contracts (auth tokens, and an
assistant tool-loop contract distilled from 63 fix commits on the same
failure class) and twenty domain-context entries.

Neither review is mandatory, and about once a month is plenty. Running
them after a heavy fix period works as well as a schedule. If a schedule
suits you, anything that can invoke the CLI works
(``claude -p "/mine-history"`` from cron or a calendar automation), and
Claude Code users can create a routine with the ``/schedule`` command.

Token economics
---------------

Token spend is treated as a design constraint, and most of the savings
here are structural rather than tooling:

- Always-loaded context is capped: the instruction files sit under a
  word budget enforced by the gate (currently 2000 words, about 2.6k
  tokens per session), while detailed knowledge lives in playbooks that
  load only when the work touches their area.

  The budget works like the lint ratchet. The number is a constant in
  ``agents-contracts.test.ts``; every instruction-file edit that pushes
  the combined count over it fails the suite, and the choice is to trim
  wording or raise the constant, where a raise is a deliberate edit to
  the gate with the reason in the commit message. Lowering is always
  welcome. This is not hypothetical: the gate has tripped mid-edit twice
  (1504 against a 1500 budget, then 1664 against 1650) and forced real
  trims before the change could land, and the one raise to 2000 was a
  recorded maintainer decision, not a silent bump.
- Ceremony is priced: implementation delegates to subagents on the
  cheapest model that fits the task, independent review runs only where
  judgment is involved, and the label guard classifies PRs from commit
  types instead of spending a model call on it.

The maintainer additionally runs
`tokless <https://github.com/HoangP8/tokless>`__, a local toolkit that
bundles several token-reduction tools: caveman (terse response style for
chat output), ponytail (a bias toward the smallest working change),
rtk (a CLI wrapper that compresses command output before it reaches the
model), codegraph (pre-indexed code structure queried instead of grepping
and reading files), and context-mode (runs analysis in a sandbox so raw
bytes stay out of the context window). None of it is required to work on
this repo; it shapes the maintainer's sessions, not the repository.

Two honest observations from using the stack on this project. Ponytail's
bias shows up in decisions that are visible in the history: two
instruction files instead of a template hierarchy, one gate file instead
of a test per rule, a shell heuristic instead of a model call in the
label guard. And output compression is the reason rule P6 exists: in one
working session the rtk wrapper capped a commit count at 50 on a
2254-commit repo, hid a failing test behind a log-file path, and masked a
red gate's exit status through a pipeline, each caught only by rerunning
the bare command. Compression tools save tokens on reads; they never wrap
a gate, and published savings claims deserve the same M2 skepticism as
any other number a tool reports about itself.

Using this in your own project
------------------------------

Copy
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
unchanged. It contains no zmNinjaNg names on purpose, and the purity gate
keeps it that way; project facts go in the other files.

Write an ``AGENTS.project.md`` for your codebase. Most of the work is the
contracts. Find the places where your code has one sanctioned path
(settings, HTTP, logging, state) and write an Owns / Path / Never / Gate
block for each, using real symbol names. Five contracts covering the paths
people actually bypass are worth more than a complete inventory.

Copy
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__
and point it at your tree: your source directory, your forbidden-token
list, a word budget measured from your own files plus headroom. Copy
`agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
as is, and start ``agents/project/`` with an empty ``domain-context.md``.
If the project has history, one ``mine-history`` run over all of it
produces most of the seed content.

Claude Code needs a two-line
`CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__
importing the two instruction files; other harnesses read ``AGENTS.md``
directly. The labels, the label-guard workflow, and the two periodic
reviews are all optional.

Do not start with thirty rules. A handful of contracts plus the core is
enough, and the protocol grows the rest one incident at a time. A rule
added because something actually happened gets followed; a rule written
speculatively is the kind that drifts.

Where everything lives
----------------------

- `AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__, the portable rule core
- `AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__, contracts and project rules
- `CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__, the Claude Code shim
- `agents/generic/claude-workflows.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__, the portable workflow playbook
- `agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__, area playbooks and `domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
- `agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__, the instruction-system gate
- `label-guard.yml <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/label-guard.yml>`__, the PR label gate
- `mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__, the history mining skill

What this asks of a contributor
-------------------------------

Human or agent, the entry points are the same: read ``AGENTS.md`` and
``AGENTS.project.md``, read the playbook for your area, and let the gates
run. If a rule seems wrong, propose a change through the protocol instead
of working around it quietly; a workaround that never becomes a rule
change is exactly the drift this setup exists to prevent. See
:doc:`09-contributing` for branches, commits, and verification commands.
