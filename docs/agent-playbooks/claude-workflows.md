# Claude workflow playbook

Advisory, not binding. Last validated 2026-07 against Claude Code with the
Claude 5 family. The instruction files (`AGENTS.md`, `AGENTS.project.md`)
state what must hold; this playbook records what has worked. When the two
disagree, the instruction files win. Harness features churn; check the date
above before trusting specifics.

## Scale ceremony to risk

Multi-agent process below pays off on multi-task plans, refactors with blast
radius, and anything touching contracts. It does not pay off on small
bounded changes: for a one-file fix with a covering test, work inline, run
the gates, commit. Evidence from the restructure run: reviews of mechanical
transcription tasks found zero defects; reviews of judgment work (doc
remapping, whole-branch review) found every real one. Review where judgment
lives; skip where the gate already proves the result. The final whole-branch
review before a PR is the one step never skipped.

## Multi-agent execution

- One subagent per task, fresh context each time. Hand each agent a brief
  file (its requirements) and a report-file path; it returns only status,
  commits, and a one-line test summary. Never paste session history into a
  dispatch.
- Model tiering: cheapest model when the task text contains the complete
  content to write (transcription plus testing); mid tier for reviews and
  prose judgment; the most capable model only for the final whole-branch
  review.
- Tasks involving judgment get an independent review against their brief
  before the next task starts; purely mechanical tasks rely on their gates.
  Fixes get a scoped re-review that verdicts each finding ADDRESSED or NOT
  ADDRESSED and looks only at the fix diff.
- After the final whole-branch review, dispatch one fix wave with the whole
  findings list, then one scoped re-review. Never one fixer per finding.
- Stop every agent as soon as its report is verified. Idle agents keep
  burning context and can wake with stale intent.
- Long-running work keeps a ledger file (task, commits, review outcome, one
  line each) outside the repo tree. Context compaction loses memory; the
  ledger plus `git log` is the recovery map.

## Trust boundaries for tooling

- Verification runs direct commands (P6 in `AGENTS.md`). Output-transforming
  tooling, such as wrappers, compressors, and summarizers, gets validated
  against raw output at least once before it is trusted, and never wraps a
  gate.
- A reviewer only re-runs tests when the code changed after the last run;
  otherwise the implementer's report carries the evidence.

## Known failure modes this playbook exists to prevent

- A compression wrapper garbled test output and hid a failure; the direct
  command showed it immediately.
- Reviewers approving their own implementation. Separate agents, always.
- Doc references that drift silently from renumbered rules; the
  `agents-contracts` gate now catches the repo cases, but dispatches into
  agents should cite rule IDs, not copied text, for the same reason.
