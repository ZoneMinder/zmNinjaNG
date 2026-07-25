---
name: mine-history
description: Use when asked to mine the commit history for lessons the agent instruction files have not captured, to audit whether domain-context and contracts reflect what actually broke, or to run the periodic learnings review. Triggers on "mine history", "audit learnings", "check domain context against history".
---

# Commit History Miner

## Overview

Verify that the instruction system (AGENTS.md, AGENTS.project.md,
`agents/project/domain-context.md`, playbooks) recorded the lessons the
repo actually paid for. The day-to-day self-improvement protocol captures
lessons one PR at a time; this skill is the periodic sweep that catches
what slipped through.

**Core principle: every candidate carries commit-hash evidence. A lesson
without a commit behind it is speculation, and speculation does not enter
the instruction files.**

## When to Use

- "mine the history for lessons", "audit the agent files against history"
- After a busy stretch of fixes, or roughly monthly (see Cadence)
- After adopting this instruction system in a repo with existing history

## Procedure

1. **Read what exists first.** AGENTS.md, AGENTS.project.md, every file in
   `agents/project/`. Only NEW lessons get reported; re-reporting a
   covered fact is noise that erodes trust in the sweep.
2. **Scope the window.** First run: full history. Later runs: since the
   last mining commit (find it with
   `git log --grep="history-mined" --oneline`).
3. **Probe, in order of yield:**
   - Reverts: `git log --grep=revert -i --oneline`. Each revert is a paid
     experiment; the lesson is what not to retry and what worked instead.
   - Fix chains: group `fix(<scope>):` commits by scope; any scope with a
     disproportionate count is one misunderstanding surfacing repeatedly.
     Ask what stable fact would have prevented the class.
   - Churn files: rank files by fix-commit touches; read the fix bodies.
   - Should-not-have-happened: fixes that an existing contract or gate
     should have caught. Post-gate violations mean the gate has a hole.
4. **Tooling caution.** Count with `git rev-list --count`, never piped
   `wc` (output wrappers have silently truncated pipelines here). Write
   long listings to a scratch file and read that. Sanity-check any
   suspiciously round number.
5. **Output contract**, four sections, every bullet with hashes:
   - A: ready-to-paste `domain-context.md` entries, grouped by its
     existing section headers
   - B: contract or project-rule candidates (only for recurring classes;
     name the Owns/Path/Never/Gate you would write, with real paths)
   - C: generic rule candidates (only stack-agnostic classes; expect zero
     most runs)
   - D: checked-and-already-covered list, one line each, so the next run
     knows what was verified
6. **Apply through the protocol.** Additions land as a PR touching the
   instruction files: domain entries verbatim, contracts with existing
   gate paths, budget re-checked (`agents-contracts.test.ts` enforces the
   word budget, hash validity, and privacy rules). Commit message includes
   the phrase `history-mined` so step 2 finds it next time.

## Judging candidates

| Signal | Verdict |
|---|---|
| Reverted approach with a working alternative | Domain entry: what failed, what works, do-not-retry |
| 3+ fixes, one underlying misunderstanding | Domain entry stating the stable fact |
| Recurring class across many commits (dozens) | Contract candidate, not just an entry |
| Security-shaped fix (secrets, tokens, storage) | Contract Never-line candidate |
| One-off typo/logic fix, no reusable fact | Skip; not every fix is a lesson |
| Fix predates the rule that now covers it | Already handled; list in section D |

## Cadence (optional, not mandated)

About once a month is enough; the per-PR protocol does the daily work.
To schedule instead of remembering: any scheduler that can run the CLI
works (`claude -p "/mine-history"` from cron or a calendar automation), or
create a Claude Code routine with the `/schedule` command ("run
/mine-history on the first of each month"). Running it manually after a
heavy fix period is just as valid.
