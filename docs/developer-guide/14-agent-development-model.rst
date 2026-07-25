Agent development model
=======================

Most code in this repository is written by AI agents, and the diffs are not
line-reviewed by a person. This chapter explains why that works here, what
enforces correctness instead, and the two places where a human still
reviews deliberately.

Why diffs are not line-reviewed
-------------------------------

Reading every generated diff stopped scaling early, and it was never good
review to begin with: a person skimming a few hundred generated lines
misses more than a failing test does. The effort went into constraints
instead. Every rule an agent has to follow is written down; every rule a
script can check has a script checking it; when something breaks that no
rule covered, the fix has to include the rule that would have covered it.
The maintainer states what should happen (a bug, a feature, an issue
number), an agent does the work, and the gates decide whether it lands.

A related decision: project knowledge stays in the repository, not in an
agent's session memory. Session memory cannot be seen by other agents,
other contributors, or CI, and it disappears with the machine it lives on.
Commit history has a similar problem: a revert or a string of fixes to the
same file is something the project already paid to learn, and it stays
buried unless someone writes the lesson down. The facts in
`domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
came from doing exactly that, once across agent memory and once across the
full commit history; rule M5 requires the same of every future session.

Multi-agent ceremony is treated as a cost, not as evidence of rigor.
Dispatching ten agents at a change looks thorough, but every dispatch
re-reads the same context, and in practice, agent reviews of mechanical
work here found nothing that the gates had not already proven. Independent
agent review is reserved for work that needs judgment, plus one
whole-branch review before every PR. For a small bounded change, working
inline and letting the gates run is the normal path.

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
addresses, and rule IDs cited in this guide resolve. Rule M2 covers the
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

Monthly scorecard review
------------------------

Gates only catch what they were built to catch. Drift is whatever nobody
wrote a gate for yet: duplication spreading across files, tests that pass
without asserting much, a convention the code quietly stopped following.
The first of the two deliberate human reviews covers this: roughly once a
month, a scorecard review of the whole codebase.

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
