# AGENTS.md redesign: portable core, architecture contracts, self-improvement

Date: 2026-07-25
Status: approved design, pending implementation plan

## Goal

Restructure the instruction system so that:

1. `AGENTS.md` becomes a portable, world-class instruction template with zero
   zmNinjaNg-specific content. Any project in this stack can copy it verbatim.
2. Project-specific knowledge moves to `AGENTS.project.md`, including a new
   architecture-contracts layer that describes the system well enough that an
   agent does not need to rediscover invariants by reading code.
3. The instruction files become self-improving through a defined protocol.
4. Quality for zmNinjaNg does not decrease: every current rule has a tracked
   disposition, and all existing gates stay untouched.

## Decisions (agreed 2026-07-25)

| Question | Decision |
|---|---|
| Architecture contracts | Full contracts layer, ~12-15 subsystem blocks |
| Distillation depth | Distill hard; gates carry enforcement; migration table proves nothing lost |
| Self-editing autonomy | Propose-only: fix PR includes instruction edit plus gate; human merges |
| Packaging for other projects | `AGENTS.md` itself is the template; no separate artifact |
| File layout | Two files: `AGENTS.md` (portable) and `AGENTS.project.md` (contracts + project rules) |

## File layout

```
CLAUDE.md            "Use @AGENTS.md and @AGENTS.project.md as your instructions."
AGENTS.md            portable core (~100 lines, no project references)
AGENTS.project.md    zmNinjaNg contracts + project rules + playbook table
docs/agent-playbooks/  unchanged
```

Claude Code loads both files through the `@` imports in `CLAUDE.md`. Other
agents (Codex, Cursor) read `AGENTS.md` natively; its preamble contains a
plain-text mandate to read `AGENTS.project.md` before any work.

## AGENTS.md structure (portable core)

### Preamble

What the file is, load order (this file, then `AGENTS.project.md`, then the
area playbook), and a three-line adoption note: copy this file verbatim,
write your own `AGENTS.project.md` and gates, never edit the core to add
project facts.

### Rule format

Every rule is one line in the form: statement, why-clause, gate reference.
Rules without a possible gate carry an incident reference instead.

### Distilled generic rules

Tier 0, invariants (never simplified away):

- I1. Validate at trust boundaries. Server responses, user input, and IPC are
  never assumed well-formed.
- I2. No data-loss paths. Destructive operations need error handling and
  recovery consideration.
- I3. Security and accessibility never distilled away. Accessibility lint is
  blocking.

Tier 1, process:

- P1. Issue before feature or bug work; land via issue-linked PR. `refs #id`
  in commits; `fixes` only after user confirms.
- P2. TDD. A failing test precedes implementation for every feature and
  bugfix.
- P3. Full gate suite before commit. Never commit after a failed or unrun
  gate.
- P4. Read failures. Fix the root cause. Never blindly retry.
- P5. One logical change per conventional commit.
- P6. Verification runs direct commands. Tooling that transforms output
  (wrappers, compressors, summarizers) is untrusted until validated against
  raw output at least once.
- P7. Finish requested behavior. Materially different UX options need
  approval before choosing.
- P8. Never merge the default branch without approval.
- P9. Do not commit plan files.
- P10. Docs move with behavior. User docs for changed behavior; developer
  docs and call flows for new APIs, components, hooks, utilities.

Tier 2, code:

- C1. Reuse ladder: existing codebase helper, then stdlib, then platform
  feature, then installed dependency, then new code. New dependencies are a
  last resort.
- C2. Files near 400 LOC. No dead code, commented-out replacements, or
  speculative abstractions.
- C3. Never hardcode user-facing text. Every locale updates together.
- C4. Never inline semantic values. Constants live in dedicated modules.
- C5. New modules live in domain folders. No one-file folders.
- C6. Test assertions must be able to fail. Assert fetched values or
  user-visible outcomes, never element existence or non-empty containers.
- C7. Lint ratchet: the baseline shrinks or holds, never grows. Raising a
  number requires a reason in the commit message.

Tier 3, meta (governs this file):

- M1. A rule a script can check needs a gate, added in the same change.
  Ungated rules drift.
- M2. A gate's input needs checking, not just its exit code. Confirm the
  number a gate reports describes the thing it claims to.
- M3. Instruction files change only through the self-improvement protocol.
  One-off facts belong in the project file or playbooks, not here.
- M4. This file owns process rules. Other docs link to rules, never copy
  them.

### Self-improvement protocol

Trigger: a breakage, review finding, or wasted work session that a rule or
contract would have prevented, or an existing rule that itself caused harm.

Action: the PR that fixes the problem must also include the proposed edit to
`AGENTS.md` or `AGENTS.project.md`, plus the gate required by M1. The
maintainer merges or rejects the instruction change like any other diff.
Agents never edit instruction files outside this protocol.

### Pointer

Final section: mandate to read `AGENTS.project.md`, which owns contracts,
project rules, verification commands, and the playbook table.

## AGENTS.project.md structure (zmNinjaNg)

### Architecture contracts

Fixed block format:

```
### <Subsystem>
Owns: <the one responsibility>
Path: <the sanctioned API or flow>
Never: <forbidden bypasses>
Gate: <test or lint reference>
```

Planned contracts (exact paths and gates confirmed by codebase sweep during
implementation):

1. Settings: profile-scoped via `getProfileSettings` / `updateProfileSettings`;
   coercions in `mergeProfileSettings`; never direct storage access.
2. Polling and bandwidth: intervals from `useBandwidthSettings()` /
   `getBandwidthSettings()`; never literal intervals.
3. HTTP: `lib/http.ts` helpers; never raw `fetch()` or `axios`.
4. Logging: `log.*` helpers with explicit `LogLevel`; never `console.*`.
5. React Query: keys and invalidations from `query-keys.ts`; profile keys via
   `asProfileId()`.
6. Zustand stores: subscriptions select all reactive fields, `useShallow`
   where needed; never mutate `getState()` objects.
7. Services and stores boundary: services never statically import stores;
   gates instead; module graph acyclic (existing gate
   `src/tests/no-circular-deps.test.ts`).
8. Error and loading UI: `ErrorBanner` plus `resolveQueryError(err, t)`;
   shared query-state skeletons.
9. Date and time: `useDateTimeFormat()` or `formatAppDate*`; never literal
   date-fns patterns.
10. i18n: locale files under `app/src/locales/`; every locale updates
    together; both language pickers.
11. Native (Capacitor): plugins import dynamically behind platform checks
    with test mocks; mobile downloads use Capacitor HTTP base64, never Blob;
    TLS trust accepts-any without a stored fingerprint (TOFU).
12. Constants: `lib/zmninja-ng-constants.ts` and `lib/zm-constants.ts`.

### Project process rules

- npm commands run from `app/`; root `npm install` once first.
- Labels fit 320px; concise translations.
- UI changes need an outcome-based e2e test, platform tags, and
  `data-testid` on new interactive elements.
- Only one `npm run test:e2e` per working tree.
- Device e2e (iOS, Android, Tauri) is manual-only.
- Flex text uses `min-w-0`, `truncate`, `title`; multi-line uses
  `line-clamp-N`.
- Do not commit incidental native build-number bumps; intended bumps land
  alone as `chore:`.
- GitHub comments identify Claude assisting @pliablepixels with the exact
  attribution line; commits do not.
- Test builds use a matching existing GitHub workflow.
- Developer docs teach React where they first rely on it.

### Verification commands

The existing command list (npm test, tsc -b, build, three lint gates, e2e)
moves here unchanged.

### Playbook table

The existing read-first table moves here unchanged.

## Disposition table: all 38 current rules

| Old | Content | New home |
|---|---|---|
| 1 | Plain prose, no filler, teach React | Core P10 (docs move with behavior) + documentation playbook; React clause in project rules |
| 2 | Issue before work | Core P1 |
| 3 | Test gates before commit | Core P3 |
| 4 | Docs updated with behavior | Core P10 |
| 5 | No hardcoded user text, all locales | Core C3 + contract 10 |
| 6 | UI e2e, platform tags, data-testid, failing assertions | Project rule + core C6 |
| 7 | Profile-scoped settings | Contract 1 |
| 8 | Bandwidth-derived polling | Contract 2 |
| 9 | log.* with LogLevel | Contract 4 |
| 10 | lib/http.ts only | Contract 3 |
| 11 | Flex text truncation | Project rule |
| 12 | 400 LOC, no dead code | Core C2 |
| 13 | Capacitor dynamic imports + mocks | Contract 11 |
| 14 | Mobile downloads base64 | Contract 11 |
| 15 | No plan files | Core P9 |
| 16 | Finish behavior, UX approval | Core P7 |
| 17 | No merging main | Core P8 |
| 18 | One change per commit, refs/fixes | Core P5 + P1 |
| 19 | Read failures, fix cause | Core P4 |
| 20 | 320px labels | Project rule |
| 21 | Date/time hooks | Contract 9 |
| 22 | Rules only on recurring failure | Core M3 + protocol |
| 23 | Semantic constants | Core C4 + contract 12 |
| 24 | GitHub attribution | Project rule |
| 25 | Build-number bumps | Project rule |
| 26 | query-keys.ts, asProfileId | Contract 5 |
| 27 | Zustand rules | Contract 6 |
| 28 | Services/stores acyclic | Contract 7 |
| 29 | ErrorBanner, skeletons | Contract 8 |
| 30 | Domain folders | Core C5 |
| 31 | Blocking lints + ratchet | Core I3 + C7; commands in project verification |
| 32 | Issue-linked PR landing | Core P1 |
| 33 | One e2e per tree | Project rule |
| 34 | Direct commands, no wrappers | Core P6 (generalized to all output-transforming tooling) |
| 35 | AGENTS.md owns process | Core M4 |
| 36 | Existing workflows for test builds | Project rule |
| 37 | Checkable rules need gates | Core M1 |
| 38 | Gate inputs need checking | Core M2 |

Nothing is dropped. Incident stories (rule 37's 2026-07 audit) compress to
one-clause whys per the distill-hard decision.

## New gate

`src/tests/agents-contracts.test.ts`: parses the `Path:`, `Never:`, and
`Gate:` lines of each contract block in `AGENTS.project.md` and asserts that
every named symbol, file, and gate exists in the codebase. A refactor that
moves a sanctioned API fails CI until the contract updates. This is what
keeps "read the file, not the code" true over time, and it satisfies M1 for
the contracts layer itself.

## Migration verification

1. Disposition table above reviewed row by row during implementation.
2. Throwaway check: every old rule's key terms grep-match somewhere in the
   new file set. Run once, not committed as a gate.
3. Existing gates in `src/tests/` and lint configs untouched.
4. Full verification suite passes after the swap.

## New additions beyond restructuring

- TDD rule (P2): new; current rule 3 only mandated running gates.
- P6 generalization: born from the observed incident where compression
  tooling garbled verification output.
- Self-improvement protocol: new.
- Contracts layer and its gate: new.

## Out of scope

- Monthly codebase-review scheduling (separate discussion).
- Changes to playbook contents.
- Extracting a standalone template repository.

## Risks

- Two always-loaded files: total context stays near today's size because
  distillation offsets contract additions. Measured during implementation.
- Non-Claude agents may skip `AGENTS.project.md`: mitigated by the plain-text
  mandate in the core preamble and by gates catching violations.
- Contract gate false positives (symbol renames in comments): the test greps
  code, not docs, and matches exact exported names; tuned during
  implementation.
