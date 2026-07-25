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

Two more principles follow from it.

**Knowledge lives in the repo, not in anyone's memory.** Agent sessions
keep private memory, and it is the worst place for a project fact: it is
invisible to other agents, other contributors, and CI, and it dies with
the session or the machine. The same goes for commit history: every revert
and every fix-after-fix chain is a lesson the project already paid for,
and leaving it buried means paying for it again. That is why this repo's
domain playbook was seeded by extracting verified facts out of agent
memory and out of 2254 commits of history, and why rule M5 makes that flow
mandatory: facts learned the hard way land in the shared files, and only
private specifics stay in memory.

**Agent count is a cost, not a quality metric.** A task force of ten
named agents reads as rigor and usually is not: each dispatch re-reads
context, and a review of mechanical work finds nothing the gates did not
already prove. The measure of a workflow is what its steps catch, so
ceremony concentrates where judgment lives (an independent review of a
tricky change, one whole-branch review before a PR) and the harness is
left to do what a fleet of hand-orchestrated agents would only imitate.
When in doubt, work inline and let the gates decide.

Rules, gates, and practices
---------------------------

The system uses three words precisely, and the distinction carries most of
the design:

**Rules are binding statements.** They live in ``AGENTS.md`` with stable
tier IDs (I1 to I3 for invariants, P for process, C for code, M for the
meta rules that govern the instruction files themselves) and in
``AGENTS.project.md`` as project rules. A rule states what must hold, a
one-clause why, and where it is enforced. Rules change only through the
self-improvement protocol: the PR that hit the problem proposes the rule,
the maintainer merges or rejects it. **Contracts** are rules specialized
to one subsystem: each names what the subsystem owns, the one sanctioned
path through it, the bypasses that are always bugs, and its gate.

**Gates are the scripts that enforce rules.** A rule a script can check
must have a gate, added in the same change (rule M1); this repo learned
that from an audit in which every ungated rule had been violated and every
gated rule held. Gates here include the unit suite, the three blocking
lints, the ratcheted lint baseline, the CI label guard (every PR carries a
``core`` or ``refactor`` label, auto-assigned from commit types), and
``agents-contracts.test.ts``, which checks the instruction system itself:
contract symbols still exist in the code, the core file stays
project-free, the instruction files stay under a word budget, commit
hashes cited as evidence in the domain playbook exist in history, the
knowledge files contain no emails or addresses, and this guide's rule
references resolve. A gate's own input gets checked too (rule M2): a
number a gate reports must describe the thing it claims to measure.

**Practices are advisory guidance.** They live in the playbooks under
``agents/``: how to run multi-agent work, how to scale review ceremony to
risk, which model tier fits which task, plus the domain facts in
``domain-context.md``. Practices carry evidence (commit hashes, dated
validation) instead of IDs, load only when the work touches their area,
and lose to rules on any conflict. A practice earns promotion into a rule
when violating it starts breaking things; a rule that turns out to be
wrong is demoted or deleted the same way it entered.

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

**Gates.** ``app/src/tests/`` and the CI workflows carry the enforcement
described in the section above; the covering gates run on every commit and
the full battery runs before a push or PR (rule P3).

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

The history mining review
-------------------------

The per-PR protocol captures lessons one fix at a time, but it only fires
when someone notices a lesson was learned. The ``mine-history`` skill
(``.claude/skills/mine-history/``) is the periodic sweep for what slipped
through: it walks the commit history looking at reverts (each one a paid
experiment), fix-after-fix chains on the same subsystem, and fixes that an
existing gate should have caught, then reports candidate entries for
``domain-context.md`` and candidate contracts, every one backed by commit
hashes. Its first run over this repo's 2254 commits produced two contracts
(auth tokens and the assistant tool loop, the latter distilled from a
63-commit fix saga) and twenty domain-context entries.

Both reviews are worth running about once a month, but neither is
mandatory; run them when they earn their time, such as after a heavy fix
period. If scheduling suits you better, anything that can invoke the CLI
works (``claude -p "/mine-history"`` from cron or a calendar automation),
and Claude Code users can create a routine with the ``/schedule`` command,
for example "run /mine-history on the first of each month".

Using this in your own project
------------------------------

The system is built to be copied. The split of files is the instruction:
everything portable is deliberately free of this project's names.

1. Copy ``AGENTS.md`` verbatim. Do not edit it to add your project's
   facts; that is what the other files are for, and the purity gate
   exists to keep it that way.
2. Write your own ``AGENTS.project.md``. The contracts are the real work:
   walk your codebase and, for each subsystem that has one sanctioned
   path (settings, HTTP, logging, state, whatever your stack centralizes),
   write an Owns / Path / Never / Gate block with real symbol names.
   Start with the five most-bypassed paths, not a complete inventory.
3. Port the gate. Copy ``app/src/tests/agents-contracts.test.ts``, point
   it at your source tree, set the forbidden-token list to your project's
   names, and set the word budget from your own baseline (measure your
   files, add headroom, ratchet from there).
4. Copy ``agents/generic/`` as is. Create ``agents/project/`` with
   whatever area playbooks your project needs, plus an empty
   ``domain-context.md``. If the project has history, run the
   ``mine-history`` skill once over all of it; that first sweep is where
   most of the seed content comes from.
5. Wire your harness: for Claude Code a two-line ``CLAUDE.md`` importing
   both instruction files; other harnesses read ``AGENTS.md`` directly and
   follow its pointer.
6. Optional: the ``core`` / ``refactor`` labels with the label-guard
   workflow, and the monthly reviews.

What not to do: do not start with thirty rules. Start with the core plus a
handful of contracts, and let the protocol grow the rest one incident at a
time; every rule that arrives with a commit hash behind it will be
followed, and rules invented in advance are the ones that drift.

What this asks of a contributor
-------------------------------

Human or agent, the entry points are the same: read ``AGENTS.md`` and
``AGENTS.project.md``, read the playbook for the area, and let the gates
run. If a rule seems wrong, propose a change to the rule through the
protocol rather than quietly working around it; a workaround that never
becomes a rule change is exactly the drift the system exists to prevent.
See :doc:`09-contributing` for the mechanics of branches, commits, and
verification commands.
