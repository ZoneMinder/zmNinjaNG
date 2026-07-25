Agent development model
=======================

Most code in this repository is written by AI agents, and nobody
line-reviews those diffs. This chapter explains why that is safe here, what
enforces it, and where a human still reviews deliberately.

Why diffs are not line-reviewed
-------------------------------

Reading every generated diff does not scale, and it is weak review anyway:
a human skimming hundreds of lines misses more than a test that fails
loudly. So review effort moves from inspecting output to constraining
input. Every rule an agent must follow is written down, every rule a
script can check has a script checking it, and anything that slips through
both becomes a new rule with a new check. Correctness comes from that
structure, not from staring at pull requests.

You state intent ("fix this bug", "add this feature", an issue number), an
agent does the work, and gates decide whether it lands.

Two principles follow from this setup.

**Knowledge lives in the repo, not in anyone's memory.** Agent sessions
keep private memory, and it is a bad place for a project fact: invisible
to other agents, other contributors, and CI, and gone with the session or
the machine. Commit history has the same problem; every revert and every
fix-after-fix chain is a lesson already paid for, and leaving it buried
means paying twice. This repo's
`domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
was seeded by pulling verified facts out of agent memory and out of 2254
commits of history, and rule M5 makes that flow mandatory: facts learned
the hard way land in shared files, only private specifics stay in memory.

**Agent count is a cost, not a quality metric.** A task force of ten named
agents looks rigorous and usually is not: each dispatch re-reads context,
and reviewing mechanical work finds nothing gates did not already prove.
Judge a workflow by what its steps catch. Concentrate ceremony where
judgment lives (an independent review of a tricky change, one whole-branch
review before a PR), let the harness parallelize, and when in doubt work
inline and let gates decide.

Rules, gates, and practices
---------------------------

Three words carry most of the design, used precisely:

**Rules are binding statements.** They live in
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
with stable tier IDs (I for invariants, P for process, C for code, M for
meta rules governing the instruction files themselves) and in
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__
as project rules. A rule states what must hold, a one-clause why, and
where it is enforced. Rules change only through the self-improvement
protocol: the PR that hit a problem proposes the rule, the maintainer
merges or rejects it. **Contracts** are rules specialized to one
subsystem: what it owns, the one sanctioned path through it, the bypasses
that are always bugs, and its gate.

**Gates are scripts that enforce rules.** A rule a script can check must
have a gate, added in the same change (rule M1); an audit here once found
every ungated rule violated while every gated rule held. Gates include the
unit suite, three blocking lints, the ratcheted lint baseline, a CI
`label guard <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/label-guard.yml>`__
(every PR carries a ``core`` or ``refactor`` label, auto-assigned from
commit types), and
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__,
which checks the instruction system itself: contract symbols still exist
in code, the core file stays project-free, instruction files stay under a
word budget, commit hashes cited as evidence exist in history, knowledge
files contain no emails or addresses, and this guide's rule references
resolve. Gate inputs get checked too (rule M2): a number a gate reports
must describe what it claims to measure.

**Practices are advisory guidance.** They live in the playbooks under
`agents/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents>`__:
how to run multi-agent work, how to scale review ceremony to risk, which
model tier fits which task, plus the domain facts in ``domain-context.md``.
Practices carry evidence (commit hashes, dated validation) instead of IDs,
load only when work touches their area, and lose to rules on any conflict.
A practice gets promoted into a rule when violating it starts breaking
things; a wrong rule gets demoted or deleted the same way it entered.

How the pieces fit
------------------

**Instruction files.**
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
at the repo root is the portable core.
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__
holds what is specific to this project: fourteen architecture contracts
plus project rules. An agent changing settings behavior does not
rediscover the design from source; the Settings contract states it.

**Playbooks.**
`agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__
holds area guides (testing, docs, native, data integrity) and
``domain-context.md``, verified project facts: API quirks, platform
behavior, approaches that already failed.
`agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
holds portable workflow guidance. Playbooks load only when work touches
their area, so they can be detailed without costing every session context.

**Gates.** ``app/src/tests/`` and the CI workflows carry the enforcement
described above; covering gates run on every commit, the full battery
before a push or PR (rule P3).

**Agent-side review.** Review happens on every change; agents do it, not
the maintainer. The workflow in
`claude-workflows.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__
pairs implementers with independent reviewers on judgment-heavy work, and
one whole-branch review always runs before a PR. CI runs the full gate
suite on every push, and the
`claude.yml <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/claude.yml>`__
workflow summons an agent onto any issue or PR by mention.

**Self-healing.** When something breaks anyway, the fix is not just a
patch. The protocol requires the fixing PR to also propose the instruction
change that would have prevented the break, with the gate M1 demands, and
rule M5 sends durable facts to ``domain-context.md`` instead of any one
agent's memory. You review these small instruction diffs instead of large
code diffs, and the rulebook absorbs each failure once.

Monthly scorecard review
------------------------

Gates catch what they were built to catch. Drift is what nobody wrote a
gate for yet: duplication creeping across files, tests that pass without
asserting much, a convention the repo quietly stopped following. For that,
run a deliberate deep review about once a month with the scorecard skill.
It works like an audit, not an essay:

- Twelve weighted pillars: architecture, test quality, code quality, DRY,
  type safety, error handling, security, convention self-consistency,
  performance, documentation, tooling, accessibility and i18n.
- Every score is backed by a command that was actually run. A pillar with
  no command output behind it does not get a number.
- Test quality is scored by what the suite would catch (assertion density,
  failure paths, boundary cases, mock saturation), never by test count.
  Decisive probe: name one plausible bug the suite would miss.
- Output is a gates table, per-pillar evidence and score, one weighted
  overall number, and a ranked fix list.

Ranked fixes become issues, issues become agent work.
`Issue #281 <https://github.com/ZoneMinder/zmNinjaNg/issues/281>`__ is a
worked example: a 12-pillar review found React correctness gaps, mis-scoped
coverage measurement, and import cycles; the issue tracked the hardening,
and several resulting checks (the cycle gate, scoped lint configs) are now
permanent gates. Each month's review finds a class of problem, the fix
turns it into a gate, and the next review looks for something new.

Mining history for lessons
--------------------------

The per-PR protocol captures lessons one fix at a time, but only fires
when someone notices a lesson was learned. The
`mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__
skill sweeps for what slipped through: it walks commit history looking at
reverts (each one a paid experiment), fix-after-fix chains on the same
subsystem, and fixes an existing gate should have caught, then reports
candidate ``domain-context.md`` entries and candidate contracts, each
backed by commit hashes. Its first run over 2254 commits produced two
contracts (auth tokens, and the assistant tool loop distilled from a
63-commit fix saga) and twenty domain-context entries.

Both reviews are worth running about once a month; neither is mandatory.
Run them when they earn their time, such as after a heavy fix period. To
schedule instead, anything that can invoke the CLI works
(``claude -p "/mine-history"`` from cron or a calendar automation), and
Claude Code users can create a routine with the ``/schedule`` command, for
example "run /mine-history on the first of each month".

Using this in your own project
------------------------------

Copy
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
unchanged. It contains no zmNinjaNg names on purpose, and the purity gate
keeps it that way; project facts go in the other files.

Then write an ``AGENTS.project.md`` for your codebase. Most of the work is
the contracts. Look for the places where your code has one sanctioned path
(settings, HTTP, logging, state) and write an Owns / Path / Never / Gate
block for each, with real symbol names. Five contracts covering the paths
people actually bypass are worth more than a complete inventory.

Copy
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__
and point it at your tree: your source directory, your forbidden-token
list, a word budget measured from your own files plus some headroom. Copy
`agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
as is and start ``agents/project/`` with an empty ``domain-context.md``;
if the project has history, one run of the ``mine-history`` skill fills in
most of the seed content.

Claude Code needs a two-line
`CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__
importing the two instruction files; other harnesses read ``AGENTS.md``
directly. Labels, the label-guard workflow, and the monthly reviews are
optional.

Resist starting with thirty rules. A handful of contracts plus the core is
enough, and the protocol grows the rest one incident at a time. Rules that
arrive with a commit hash behind them get followed. Rules invented in
advance are the ones that drift.

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
run. If a rule seems wrong, propose a change through the protocol rather
than quietly working around it; a workaround that never becomes a rule
change is exactly the drift this setup exists to prevent. See
:doc:`09-contributing` for branches, commits, and verification commands.
