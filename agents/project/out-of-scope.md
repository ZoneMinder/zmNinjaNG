# Out of scope

Requests the maintainer has declined, with the reason, so nobody re-opens or
re-proposes them without new evidence. Check this before opening an issue or
suggesting a feature (P1). One entry per decision: the gist, why, and the
issue that records it. An entry is reopened only by a new issue that cites
the old one and says what changed.

- Rewriting inert code comments that cite pre-restructure AGENTS.md rule
  numbers. The instruction files and developer guide are remapped and gated;
  comment churn across ~50 files buys nothing. Refs #285.
- Feature suggestions made without first checking the existing surface.
  Several proposed "new" features already existed. Grep the code and the
  user guide before proposing; an inventory from a subagent alone misses
  things.
