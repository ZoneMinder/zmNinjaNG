# AGENTS.md Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split AGENTS.md into a portable instruction core plus a project file with architecture contracts, gated by a new test, per issue #283 and the spec at `docs/superpowers/specs/2026-07-25-agents-md-redesign-design.md`.

**Architecture:** Two instruction files. `AGENTS.md` holds distilled generic rules in four tiers (I/P/C/M) and a self-improvement protocol; `AGENTS.project.md` holds 12 architecture contracts and project rules. A vitest gate parses the contracts and asserts every named symbol and path exists, and asserts the core file stays project-free. Dev docs re-link from old rule numbers to new IDs.

**Tech Stack:** Markdown, vitest (existing setup in `app/src/tests/`), Node fs.

## Global Constraints

- All work on branch `docs/agents-restructure-283`, created from `origin/main`.
- Commits: conventional, one logical change, end with `refs #283`. No `fixes`.
- Never commit with a failing or unrun gate: run `npm test` (from `app/`) before every commit.
- Doc prose: plain, factual, no em-dashes (gate: `app/src/tests/no-em-dash.test.ts`).
- Do not modify anything under `docs/agent-playbooks/`.
- Do not commit `docs/superpowers/` spec or plan files (rule 15). They stay untracked.
- PR body ends with the Claude attribution line and the generated-with footer.

---

### Task 1: Branch setup

**Files:** none modified.

- [ ] **Step 1: Create branch**

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git fetch origin main
git checkout -b docs/agents-restructure-283 origin/main
```

- [ ] **Step 2: Verify clean state and baseline gates**

```bash
cd app && npm test
```

Expected: PASS (baseline before any change).

---

### Task 2: Contract gate + AGENTS.project.md

**Files:**
- Create: `app/src/tests/agents-contracts.test.ts`
- Create: `AGENTS.project.md` (repo root)

**Interfaces:**
- Produces: `parseContracts(md)` internal to the test; contract block format `### Name` + `Owns:`/`Path:`/`Never:`/`Gate:` lines that Task 3's purity check and Task 5's doc-ref check extend.

- [ ] **Step 1: Write the failing test**

Create `app/src/tests/agents-contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const appSrc = path.resolve(repoRoot, 'app/src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceText = walk(appSrc)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

interface Contract {
  name: string;
  body: string;
}

function parseContracts(md: string): Contract[] {
  const section = md.split('## Architecture contracts')[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n### ')
    .slice(1)
    .map((block) => {
      const [name, ...rest] = block.split('\n');
      return { name: name.trim(), body: rest.join('\n') };
    });
}

function backtickTokens(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ''));
}

describe('AGENTS.project.md architecture contracts', () => {
  const projectFile = path.join(repoRoot, 'AGENTS.project.md');

  it('exists and holds at least 12 contracts with all four lines', () => {
    const md = fs.readFileSync(projectFile, 'utf8');
    const contracts = parseContracts(md);
    expect(contracts.length).toBeGreaterThanOrEqual(12);
    for (const c of contracts) {
      for (const field of ['Owns:', 'Path:', 'Never:', 'Gate:']) {
        expect(c.body, `${c.name} missing ${field}`).toContain(field);
      }
    }
  });

  it('every symbol and path named in Path/Gate lines exists', () => {
    const md = fs.readFileSync(projectFile, 'utf8');
    for (const c of parseContracts(md)) {
      const lines = c.body
        .split('\n')
        .filter((l) => l.startsWith('Path:') || l.startsWith('Gate:'));
      for (const token of lines.flatMap(backtickTokens)) {
        if (token.includes('/')) {
          expect(
            fs.existsSync(path.join(repoRoot, token)),
            `${c.name}: path ${token} missing`,
          ).toBe(true);
        } else {
          expect(
            sourceText.includes(token),
            `${c.name}: symbol ${token} not found in app/src`,
          ).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run src/tests/agents-contracts.test.ts
```

Expected: FAIL, `ENOENT ... AGENTS.project.md`.

- [ ] **Step 3: Write AGENTS.project.md**

Create `AGENTS.project.md` at repo root with exactly this content:

```markdown
# zmNinjaNg Project Instructions

Read `AGENTS.md` first. This file owns everything project-specific:
architecture contracts, project rules, verification commands, and the
playbook table. Contracts state system invariants. The sanctioned path is
the only path; a bypass is a bug even when it works.

## Architecture contracts

### Settings
Owns: all profile-scoped user preferences.
Path: `getProfileSettings` / `updateProfileSettings` on the settings store (`app/src/stores/settings.ts`); every coercion or default lives in `mergeProfileSettings`.
Never: direct storage access; non-profile-scoped preference keys; coercions outside the merge (reactive readers such as `useCurrentProfile` bypass per-getter fixes).
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Polling
Owns: every recurring refresh interval.
Path: `useBandwidthSettings` / `getBandwidthSettings` (`app/src/hooks/useBandwidthSettings.ts`).
Never: literal interval values; users tune bandwidth globally.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### HTTP
Owns: all network requests, including native TLS handling.
Path: helpers in `app/src/lib/http.ts`.
Never: raw `fetch` or `axios`.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Logging
Owns: all diagnostic output.
Path: `log` helpers with explicit `LogLevel` (`app/src/lib/logger.ts`).
Never: `console` calls in app code.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Server queries
Owns: React Query keys, invalidation, and caching.
Path: keys and invalidations from `app/src/lib/query/query-keys.ts`; profile-scoped keys wrap ids with `asProfileId`.
Never: inline key arrays; unwrapped profile ids in keys.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Stores
Owns: client state via Zustand.
Path: subscriptions select every reactive field they read, with `useShallow` for multi-field selects (`app/src/stores/`).
Never: mutating objects returned by `getState`; whole-store subscriptions.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Service boundary
Owns: the dependency direction between services and stores.
Path: services reach stores only through gates; the module graph stays acyclic.
Never: a service statically importing a store.
Gate: `app/src/tests/no-circular-deps.test.ts`.

### Query UI states
Owns: what users see while data loads or fails.
Path: `ErrorBanner` (`app/src/components/ui/query-state.tsx`) with `resolveQueryError` (`app/src/lib/query/query-error.ts`); shared query-state skeletons for loading.
Never: ad-hoc error markup or raw error strings.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Date and time
Owns: user-facing date and time rendering.
Path: `useDateTimeFormat` (`app/src/hooks/useDateTimeFormat.ts`) or `formatAppDate` helpers (`app/src/lib/format-date-time.ts`).
Never: literal date-fns pattern strings in components.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Localization
Owns: all user-facing text.
Path: locale files under `app/src/locales/` (de, en, es, fr, zh); every locale updates together; both language pickers list every locale.
Never: hardcoded user-facing strings; a string added to one locale only.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Native
Owns: everything that touches Capacitor or platform APIs.
Path: Capacitor plugins import dynamically behind a platform check, each with a test mock; mobile downloads use Capacitor HTTP base64; native TLS trust accepts any certificate when no fingerprint is stored (trust on first use).
Never: static plugin imports; Blob conversion for mobile downloads; fail-closed TLS without a stored fingerprint (breaks self-signed onboarding).
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Constants
Owns: semantic values shared across modules.
Path: app-level values in `app/src/lib/zmninja-ng-constants.ts`; ZoneMinder protocol values in `app/src/lib/zm/zm-constants.ts`.
Never: magic numbers or strings inline where a named constant exists or belongs.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

## Project rules

- Run npm commands from `app/`. Run root `npm install` once first so hooks exist.
- UI changes need an outcome-based e2e test with platform tags and `data-testid` on new interactive elements.
- Only one `npm run test:e2e` per working tree.
- Device e2e (iOS, Android, Tauri) is manual-only; agents never auto-run it.
- Labels must fit 320px; prefer concise translations.
- Flex text uses `min-w-0`, `truncate`, and a `title`; multi-line text uses `line-clamp-N`.
- Do not commit incidental native build-number bumps. Commit intended bumps alone as `chore:`.
- GitHub comments identify Claude assisting @pliablepixels, with that exact attribution line. Commits do not.
- Test builds use a matching existing GitHub workflow; add one only when none fits.
- Developer docs teach React where they first rely on it.

## Verification

```
npm test
npx tsc -b
npm run build
npm run lint:a11y
npm run lint:correctness
npm run lint:ratchet
npm run test:e2e -- <feature>.feature
```

The three lint commands are the blocking ones; `npm run lint` itself stays
advisory. The last command applies to UI, navigation, and workflow changes.
State completed checks in handoff.

## Playbooks

Read each listed playbook before work in that area.

| Work | Read first |
|---|---|
| Tests, UI, navigation, or platform checks | `docs/agent-playbooks/testing.md` |
| Developer or user documentation | `docs/agent-playbooks/documentation.md` |
| Capacitor, TLS, Electron, downloads, or native paths | `docs/agent-playbooks/native.md` |
| Assistant tools, WebLLM, or ZoneMinder schemas | `docs/agent-playbooks/data-integrity.md` |
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run src/tests/agents-contracts.test.ts
```

Expected: PASS. If a symbol check fails, the contract text is wrong, not the test: fix the contract path against the codebase.

- [ ] **Step 5: Full gate + commit**

```bash
cd app && npm test
cd .. && git add AGENTS.project.md app/src/tests/agents-contracts.test.ts
git commit -m "docs(agents): add AGENTS.project.md contracts with existence gate refs #283"
```

---

### Task 3: Rewrite AGENTS.md as portable core

**Files:**
- Modify: `AGENTS.md` (full replacement)
- Modify: `app/src/tests/agents-contracts.test.ts` (append purity describe block)

**Interfaces:**
- Consumes: contract block format from Task 2.
- Produces: rule IDs I1-I3, P1-P10, C1-C7, M1-M4 that Task 5 remaps docs onto.

- [ ] **Step 1: Append the failing purity test**

Append to `app/src/tests/agents-contracts.test.ts`:

```ts
describe('AGENTS.md stays portable', () => {
  it('contains no project-specific tokens', () => {
    const core = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const forbidden = [
      'zmNinja',
      'ZoneMinder',
      'zoneminder',
      'getProfileSettings',
      'useBandwidthSettings',
      'ErrorBanner',
      'agent-playbooks',
      'Capacitor',
      'Zustand',
      'app/src',
    ];
    for (const token of forbidden) {
      expect(core.includes(token), `AGENTS.md contains "${token}"`).toBe(false);
    }
  });

  it('instruction files stay inside the token budget', () => {
    // Both files load into every agent session. Raising this budget is a
    // deliberate act that needs a reason in the commit message, like the
    // lint ratchet (C7). Lowering it is always welcome.
    const WORD_BUDGET = 1400;
    const words = (f: string) =>
      fs.readFileSync(path.join(repoRoot, f), 'utf8').split(/\s+/).filter(Boolean).length;
    const total = words('AGENTS.md') + words('AGENTS.project.md');
    expect(total, `combined ${total} words > budget ${WORD_BUDGET}`).toBeLessThanOrEqual(WORD_BUDGET);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run src/tests/agents-contracts.test.ts
```

Expected: FAIL on several forbidden tokens (current AGENTS.md is project-specific).

- [ ] **Step 3: Replace AGENTS.md**

Replace the entire content of `AGENTS.md` with:

```markdown
# Development Guidelines

Portable instruction core. This file contains no project-specific names and
can be copied verbatim into any project. Load order: this file, then
`AGENTS.project.md` (architecture contracts, project rules, verification
commands, playbooks), then the playbook it lists for your work area. Read
`AGENTS.project.md` before any work.

Adopting this core in another project: copy this file unchanged, then write
your own `AGENTS.project.md` and the gates it names. Project facts never
belong in this file.

## Rule format

Every rule is a statement, a one-clause why, and a gate. A rule a script
could check but that names no gate is a defect in this file. Rules carry
stable IDs by tier; docs reference IDs, never copied text.

## Invariants (never simplified away)

- I1. Validate at trust boundaries: server responses, user input, IPC.
  Malformed input is expected input.
- I2. Destructive operations need error handling and a recovery path. Lost
  user data cannot be patched later.
- I3. Security and accessibility are never traded for simplicity or speed.
  Gate: blocking accessibility and correctness lints.

## Process

- P1. Create or use an issue before feature or bug work; land through an
  issue-linked PR. Commits reference the issue; closing keywords only after
  the user confirms.
- P2. Test first: a failing test precedes the implementation of every
  feature and bugfix. A test that never failed proves nothing.
- P3. Run the full gate suite before every commit. Never commit after a
  failed or unrun gate.
- P4. Read failures and fix the cause. Never blindly retry.
- P5. One logical change per conventional commit.
- P6. Verification runs direct commands. Tooling that transforms output,
  such as wrappers, compressors, or summarizers, is untrusted until its
  output has been validated against the raw output at least once.
- P7. Finish the requested behavior. Materially different UX options need
  approval before choosing.
- P8. Never merge the default branch without approval.
- P9. Do not commit plan files.
- P10. Docs move with behavior: user docs for changed behavior, developer
  docs and call flows for new APIs, components, hooks, and utilities. Doc
  prose stays plain and factual, without marketing language or filler.

## Code

- C1. Reuse ladder: existing codebase helper, then stdlib, then platform
  feature, then installed dependency, then new code. A new dependency is a
  last resort.
- C2. Keep files near 400 lines. No dead code, commented-out replacements,
  or speculative abstractions.
- C3. Never hardcode user-facing text; every locale updates together.
- C4. Never inline semantic values; constants live in their dedicated
  modules.
- C5. New modules live in domain folders. No one-file folders.
- C6. Test assertions must be able to fail: assert fetched values or
  user-visible outcomes, never that an element exists or a container has
  children.
- C7. The lint ratchet baseline shrinks or holds, never grows. Raising a
  number by hand needs a reason in the commit message.

## Meta (governs this file)

- M1. A rule a script can check needs a gate, added in the same change.
  Ungated rules drift; an audit of ungated rules found every one violated
  while every gated rule held.
- M2. A gate's input needs checking, not just its exit code. Confirm the
  number a gate reports describes the thing it claims to measure.
- M3. Instruction files change only through the self-improvement protocol
  below. One-off facts go to the project file or a playbook, never here.
- M4. This file owns process rules; other docs link to rule IDs and never
  copy the text.

## Self-improvement protocol

Trigger: a breakage, review finding, or wasted session that an instruction
or contract would have prevented, or an existing instruction that itself
caused harm.

Action: the PR fixing the problem also proposes the instruction edit, with
the gate M1 requires. The maintainer merges or rejects it like any other
diff. Agents never edit instruction files outside this protocol.

## Project knowledge

Architecture contracts, project rules, verification commands, and the
playbook table live in `AGENTS.project.md`. Contracts describe each
subsystem: what it owns, the sanctioned path, forbidden bypasses, and the
gate. Trust the contract instead of rediscovering the invariant from code;
if code and contract disagree, that is a finding for the self-improvement
protocol.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run src/tests/agents-contracts.test.ts
```

Expected: PASS (both describe blocks).

- [ ] **Step 5: Full gate + commit**

```bash
cd app && npm test
cd .. && git add AGENTS.md app/src/tests/agents-contracts.test.ts
git commit -m "docs(agents): distill AGENTS.md into portable core refs #283"
```

---

### Task 4: Wire CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (repo root, currently one line)

- [ ] **Step 1: Replace content**

`CLAUDE.md` becomes:

```markdown
Use @AGENTS.md and @AGENTS.project.md as your instructions
```

- [ ] **Step 2: Verify imports resolve**

```bash
grep -c "@AGENTS" CLAUDE.md
```

Expected: `1` line containing both imports; both files exist at repo root.

- [ ] **Step 3: Commit**

```bash
cd app && npm test
cd .. && git add CLAUDE.md
git commit -m "docs(agents): import project instruction file in CLAUDE.md refs #283"
```

---

### Task 5: Remap dev-doc rule references

**Files:**
- Modify: `docs/developer-guide/*.rst` (11 files, ~118 references)
- Modify: `app/src/tests/agents-contracts.test.ts` (append doc-ref describe block)

**Interfaces:**
- Consumes: rule IDs from Task 3, contract names from Task 2.

Mapping (old rule number to new reference):

| Old | New | Old | New |
|---|---|---|---|
| 1 | P10 | 20 | project rules (AGENTS.project.md) |
| 2 | P1 | 21 | Date and time contract |
| 3 | P3 | 22 | M3 |
| 4 | P10 | 23 | C4 / Constants contract |
| 5 | C3 / Localization contract | 24 | project rules |
| 6 | C6 / project rules | 25 | project rules |
| 7 | Settings contract | 26 | Server queries contract |
| 8 | Polling contract | 27 | Stores contract |
| 9 | Logging contract | 28 | Service boundary contract |
| 10 | HTTP contract | 29 | Query UI states contract |
| 11 | project rules | 30 | C5 |
| 12 | C2 | 31 | I3 / C7 |
| 13 | Native contract | 32 | P1 |
| 14 | Native contract | 33 | project rules |
| 15 | P9 | 34 | P6 |
| 16 | P7 | 35 | M4 |
| 17 | P8 | 36 | project rules |
| 18 | P5 | 37 | M1 |
| 19 | P4 | 38 | M2 |

- [ ] **Step 1: Append the failing doc-ref test**

Append to `app/src/tests/agents-contracts.test.ts`:

```ts
describe('developer docs reference valid rule IDs', () => {
  it('every "rule <id>" reference resolves', () => {
    const valid = new Set([
      ...['I1', 'I2', 'I3'],
      ...Array.from({ length: 10 }, (_, i) => `P${i + 1}`),
      ...Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
      ...Array.from({ length: 4 }, (_, i) => `M${i + 1}`),
    ]);
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const text = fs.readFileSync(path.join(guideDir, file), 'utf8');
      for (const m of text.matchAll(/\brule ([IPCM]?[0-9]+)\b/gi)) {
        expect(valid.has(m[1].toUpperCase()), `${file}: unknown rule id "${m[1]}"`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run src/tests/agents-contracts.test.ts
```

Expected: FAIL listing old numeric references such as `rule 28`.

- [ ] **Step 3: Rewrite references**

For each file surfaced by the failing test, rewrite `rule <old>` to the
mapped reference from the table. Contract-mapped references read naturally,
for example `the Service boundary contract (AGENTS.project.md)` instead of
`rule 28`. Do not change surrounding prose beyond what the reference swap
requires. Where a sentence explains the rule's content, verify the content
still matches the new rule text and adjust minimally if the distillation
changed wording.

```bash
grep -rniE "\brule [0-9]{1,2}\b" docs/developer-guide/
```

Expected after rewriting: no output.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run src/tests/agents-contracts.test.ts
```

Expected: PASS (all three describe blocks).

- [ ] **Step 5: Full gate + commit**

```bash
cd app && npm test
cd .. && git add docs/developer-guide app/src/tests/agents-contracts.test.ts
git commit -m "docs(developer-guide): remap rule references to tiered IDs refs #283"
```

---

### Task 6: Migration verification and full suite

**Files:** none created; throwaway script runs uncommitted.

- [ ] **Step 1: Disposition sweep**

For each of the 38 old rules (disposition table in the spec), grep the new
file set for its key term and confirm the row's destination holds:

```bash
for term in "playbook" "issue" "npm test" "user docs" "locales" "data-testid" \
  "getProfileSettings" "useBandwidthSettings" "log" "http.ts" "min-w-0" "400" \
  "dynamically" "base64" "plan files" "Finish" "default branch" "conventional" \
  "cause" "320px" "useDateTimeFormat" "self-improvement" "constants" \
  "attribution" "build-number" "query-keys" "useShallow" "acyclic" \
  "ErrorBanner" "domain folders" "ratchet" "PR" "test:e2e" "direct commands" \
  "owns process rules" "workflow" "gate" "exit code"; do
  hits=$(grep -il "$term" AGENTS.md AGENTS.project.md 2>/dev/null | wc -l)
  [ "$hits" -eq 0 ] && echo "MISSING: $term"
done
```

Expected: no `MISSING:` lines. Any miss means a disposition row was dropped;
fix the file, not the check.

- [ ] **Step 2: Full verification suite**

```bash
cd app
npm test
npx tsc -b
npm run build
npm run lint:a11y
npm run lint:correctness
npm run lint:ratchet
```

Expected: all PASS. No e2e run: no UI, navigation, or workflow change.

- [ ] **Step 3: Context size check**

```bash
wc -w AGENTS.md AGENTS.project.md
git show origin/main:AGENTS.md | wc -w
```

Expected: combined count within the gate's `WORD_BUDGET` (1400 words; the
old single file is 606). The budget test in
`app/src/tests/agents-contracts.test.ts` enforces this permanently; this
step just records the numbers for the PR description.

---

### Task 7: PR

**Files:** none.

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin docs/agents-restructure-283
gh pr create --title "docs(agents): portable core, architecture contracts, self-improvement protocol" --body "Implements #283.

- AGENTS.md is now a portable instruction core: tiered rules (I/P/C/M), TDD, self-improvement protocol, zero project names (gated).
- AGENTS.project.md holds 12 architecture contracts (Owns/Path/Never/Gate) plus project rules, verification, playbook table.
- New gate app/src/tests/agents-contracts.test.ts: contract symbols/paths must exist, core stays portable, dev-doc rule references resolve.
- docs/developer-guide re-linked from old rule numbers to new IDs.
- Disposition: all 38 old rules preserved (table in issue-linked spec); existing gates untouched.

Claude assisting @pliablepixels

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Verify issue timeline**

```bash
gh issue view 283 --comments | tail -5
```

Expected: PR linked on the issue.
