# Pillar review brief

Fill every slot. The agent receiving this has no other context.

```
You are reviewing pillar <N>: <name> of the zmNinjaNg repository at
<absolute repo path>, branch <branch>, commit <short sha>.

Scores what: <Scores-what cell from the pillar table, verbatim>
Look at: <Look-at cell from the pillar table, verbatim>

Read first: AGENTS.md, AGENTS.project.md, agents/project/domain-context.md.
Approaches those files record as failed are not recommendations.

Rules:
- Read only. No edits, no commits, no npm scripts that write files.
- A grep hit is a lead. A finding is confirmed by reading the cited file.
  Drop what you cannot confirm; never soften it.
- Cite file:line plus symbol for every site.
- Quote the shortest decisive line of any output; never paste logs.
- Label each finding confirmed or theoretical.
- Deliberate simplifications in the domain playbook or a `ponytail:`
  comment are not findings.

Output, written to <scratchpad path>/pillar-<N>.md:
1. Strengths you verified, each with a site.
2. Findings, numbered P<N>-1.., each with: Severity (HIGH/MED/LOW by
   user-visible impact), Site, What is wrong, Why it matters, Fix (with
   an existing in-repo example of the pattern), Verification (gate or
   test; new behavior needs a test proven red first), Effort (S/M/L by
   site count), Risk, Contracts (rule and contract IDs only).
3. Path to 10/10, split into worth it and not worth it.
4. Non-findings: things that look wrong and must stay, with the playbook
   line that says so.

When done, send the file path and a three-line summary via SendMessage
to "main". Do not put the report body in the message.
```
