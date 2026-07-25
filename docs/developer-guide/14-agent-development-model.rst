The agent development model
===========================

Most code in this repository is written by AI agents. The maintainer does
not line-review every diff, and the project is built so that this is safe.
This chapter explains the idea, the layers that make it work, and the one
place where a human still reviews deliberately.

The idea
--------

Reading every generated diff does not scale, and it is also the weakest
form of review: a human skimming hundreds of lines misses more than a test
that fails loudly. So the project moves the review effort somewhere else.
Instead of inspecting output, it constrains input: every rule an agent must
follow is written down, every rule that a script can check has a script
checking it, and anything that slips through both is turned into a new rule
with a new check. Correctness is supposed to come from the structure, not
from a person staring at a pull request.

That is the trade. The maintainer states intent ("fix this bug", "add this
feature", an issue number), the agent does the work, and the gates decide
whether the work can land.

The layers
----------

**Instruction files.** ``AGENTS.md`` at the repo root is the portable core:
tiered rules with stable IDs (I for invariants, P for process, C for code,
M for meta rules that govern the files themselves). ``AGENTS.project.md``
holds what is specific to this project: twelve architecture contracts, each
naming what a subsystem owns, the one sanctioned path through it, the
bypasses that are always bugs, and the gate that checks it. When an agent
needs to change settings behavior, it does not rediscover the design from
source; the Settings contract states it.

**Playbooks.** ``agents/project/`` holds area guides (testing, docs,
native, data integrity) and ``domain-context.md``, a file of verified
project facts: API quirks, platform behavior, approaches that already
failed. ``agents/generic/`` holds portable workflow guidance. Playbooks
load only when the work touches their area, so they can be detailed without
costing every session context.

**Gates.** ``app/src/tests/`` carries the enforcement: the normal unit
suite, plus tests that check the instruction system itself
(``agents-contracts.test.ts`` verifies that every symbol a contract names
still exists, that the core file stays project-free, that the instruction
files stay under a word budget, and that this guide's rule references
resolve). Lint runs in three blocking forms, and the general backlog is
ratcheted: it may shrink or hold, never grow. Rule M1 is the discipline
behind all of this: a rule a script can check needs a gate, added in the
same change.

**Agent-side review.** Review still happens on every change; it is done by
agents, not the maintainer. The workflow in
``agents/generic/claude-workflows.md`` pairs implementation agents with
independent reviewer agents on judgment-heavy work, and the final
whole-branch review before a PR is never skipped. CI runs the full gate
suite on every push, and the ``claude.yml`` workflow lets the maintainer
summon an agent onto any issue or PR by mention.

**The self-healing loop.** When something breaks anyway, the fix is not
just a patch. The self-improvement protocol in ``AGENTS.md`` requires the
PR that fixes a problem to also propose the instruction change that would
have prevented it, with the gate M1 demands, and rule M5 requires durable
facts learned along the way to land in ``domain-context.md`` rather than in
any one agent's private memory. The maintainer reviews these small
instruction diffs instead of the large code diffs. Over time the rulebook
absorbs each failure once.

The monthly review
------------------

Gates catch what they were built to catch. Drift, by definition, is what
nobody wrote a gate for yet: duplication creeping across files, tests that
pass without asserting much, a convention the repo stopped following. For
that, the maintainer runs a deliberate deep review about once a month,
using a scorecard skill built for this purpose.

The scorecard review works like an audit, not an essay:

- Twelve weighted pillars: architecture, test quality, code quality, DRY,
  type safety, error handling, security, convention self-consistency,
  performance, documentation, tooling, accessibility and i18n.
- Every score is backed by a command that was actually run. A pillar with
  no command output behind it does not get a number.
- Test quality is scored by what the suite would catch (assertion density,
  failure paths, boundary cases, mock saturation), never by test count.
  The decisive probe: name one plausible bug the suite would miss.
- Output is a gates table, per-pillar evidence and score, one weighted
  overall number, and a ranked fix list.

The ranked fixes become issues, and the issues become agent work. `Issue
#281 <https://github.com/ZoneMinder/zmNinjaNg/issues/281>`_ is a worked
example: a 12-pillar review found React correctness gaps, mis-scoped
coverage measurement, and import cycles; the issue tracked the hardening
work, and several of the resulting checks (the cycle gate, scoped lint
configs) are now permanent gates. That is the loop closing: the monthly
review finds a class of problem, the fix turns it into a gate, and the
gates guard it from then on so the next month's review can look for
something new.

What this asks of a contributor
-------------------------------

Human or agent, the entry points are the same: read ``AGENTS.md`` and
``AGENTS.project.md``, read the playbook for the area, and let the gates
run. If a rule seems wrong, propose a change to the rule through the
protocol rather than quietly working around it; a workaround that never
becomes a rule change is exactly the drift the system exists to prevent.
See :doc:`09-contributing` for the mechanics of branches, commits, and
verification commands.
