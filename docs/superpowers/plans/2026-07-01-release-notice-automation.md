# Auto-Drafted Release Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a minor/major release, `make_release.sh` offers to generate an in-app developer notice; a new Node script uses `claude -p` to draft the wording, the maintainer approves it, and it is prepended to `docs/notices.json` (refs #211).

**Architecture:** A new `scripts/generate-release-notice.mjs` splits pure logic (version parsing, changelog extraction, Claude-output parsing, notice assembly, feed prepend) from a thin `main()` that does IO (spawn `claude`, prompts, file write, git). `make_release.sh` calls it, gated on `PATCH == 0`. Any notice failure is caught and never blocks the release.

**Tech Stack:** Node ESM (v18+; repo runs v23), Node built-in test runner (`node --test`), Bash, the `claude` CLI, git.

## Global Constraints

- No notice-related failure may block or abort the release. `claude` missing, non-zero exit, or unparseable output all fall back gracefully.
- `claude` not found on PATH must print a clear message and continue (user requirement).
- Claude drafts only `{title, body}`; the script sets `id`, `publishedAt`, `severity`, `link`, `minAppVersion` itself.
- `minAppVersion` = the released version. `severity` = `"info"`. `id` = `release-<version>`.
- Notice body style: plain language, no jargon, no PR/issue numbers, no em-dashes, no marketing superlatives (enforced by the Claude prompt; maintainer approval is the backstop).
- Only prompt for a notice when `PATCH == 0` (minor/major).
- Reference the issue with `refs #211`.
- Scripts tests run via `node --test` (repo Vitest is app-scoped); add a root `test:scripts` npm script.

---

### Task 1: Pure logic in `generate-release-notice.mjs` + tests

**Files:**
- Create: `scripts/generate-release-notice.mjs` (exports only, this task)
- Create: `scripts/__tests__/generate-release-notice.test.mjs`
- Modify: `package.json` (root — add `test:scripts` script)

**Interfaces:**
- Produces (all exported):
  - `parseVersionParts(version: string) -> {major, minor, patch}`
  - `isFeatureRelease(version: string) -> boolean`
  - `releaseUrl(tag: string) -> string`
  - `extractChangelogSection(changelogText: string, tag: string) -> string`
  - `parseClaudeNotice(stdout: string) -> {title, body} | null`
  - `assembleNotice({version, tag, title, body, publishedAt}) -> notice object`
  - `prependNotice(feed: any[], notice) -> any[]`

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/generate-release-notice.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersionParts, isFeatureRelease, releaseUrl,
  extractChangelogSection, parseClaudeNotice, assembleNotice, prependNotice,
} from '../generate-release-notice.mjs';

test('parseVersionParts splits semver', () => {
  assert.deepEqual(parseVersionParts('1.2.0'), { major: 1, minor: 2, patch: 0 });
  assert.throws(() => parseVersionParts('nope'));
});

test('isFeatureRelease is true only when patch is 0', () => {
  assert.equal(isFeatureRelease('1.2.0'), true);
  assert.equal(isFeatureRelease('2.0.0'), true);
  assert.equal(isFeatureRelease('1.1.0'), true);
  assert.equal(isFeatureRelease('1.1.16'), false);
});

test('releaseUrl builds the tag URL', () => {
  assert.equal(
    releaseUrl('zmNinjaNg-1.2.0'),
    'https://github.com/ZoneMinder/zmNinjaNg/releases/tag/zmNinjaNg-1.2.0'
  );
});

test('extractChangelogSection returns only the target version block', () => {
  const changelog = [
    '# Changelog', '',
    '## [zmNinjaNg-1.2.0](url) (2026-07-01)', '', '- Feature A', '- Feature B', '',
    '## [zmNinjaNg-1.1.15](url) (2026-06-17)', '', '- Old thing', '',
  ].join('\n');
  const section = extractChangelogSection(changelog, 'zmNinjaNg-1.2.0');
  assert.match(section, /Feature A/);
  assert.match(section, /Feature B/);
  assert.doesNotMatch(section, /Old thing/);
});

test('parseClaudeNotice parses bare JSON', () => {
  assert.deepEqual(
    parseClaudeNotice('{"title":"T","body":"B"}'),
    { title: 'T', body: 'B' }
  );
});

test('parseClaudeNotice strips a code fence', () => {
  assert.deepEqual(
    parseClaudeNotice('```json\n{"title":"T","body":"B"}\n```'),
    { title: 'T', body: 'B' }
  );
});

test('parseClaudeNotice returns null on garbage or missing fields', () => {
  assert.equal(parseClaudeNotice('not json at all'), null);
  assert.equal(parseClaudeNotice('{"title":""}'), null);
  assert.equal(parseClaudeNotice(''), null);
});

test('assembleNotice sets script-owned fields', () => {
  const n = assembleNotice({
    version: '1.2.0', tag: 'zmNinjaNg-1.2.0',
    title: 'T', body: 'B', publishedAt: '2026-07-01T00:00:00Z',
  });
  assert.equal(n.id, 'release-1.2.0');
  assert.equal(n.severity, 'info');
  assert.equal(n.minAppVersion, '1.2.0');
  assert.equal(n.link, 'https://github.com/ZoneMinder/zmNinjaNg/releases/tag/zmNinjaNg-1.2.0');
  assert.equal(n.title, 'T');
  assert.equal(n.body, 'B');
  assert.equal(n.publishedAt, '2026-07-01T00:00:00Z');
});

test('prependNotice adds to front and rejects duplicate id', () => {
  const feed = [{ id: 'old' }];
  const n = { id: 'release-1.2.0' };
  const out = prependNotice(feed, n);
  assert.equal(out[0].id, 'release-1.2.0');
  assert.equal(out.length, 2);
  assert.throws(() => prependNotice(out, n), /already exists/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/__tests__/generate-release-notice.test.mjs`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement the pure functions**

Create `scripts/generate-release-notice.mjs`:

```js
/**
 * Generate an in-app developer notice for a minor/major release (refs #211).
 * Pure helpers are exported for tests; main() does the IO and is guarded so it
 * only runs when the file is executed directly.
 */

const REPO = 'ZoneMinder/zmNinjaNg';

export function parseVersionParts(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!m) throw new Error(`Unparseable version: ${version}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isFeatureRelease(version) {
  return parseVersionParts(version).patch === 0;
}

export function releaseUrl(tag) {
  return `https://github.com/${REPO}/releases/tag/${tag}`;
}

/** Return the "## [tag]..." section of CHANGELOG.md up to the next "## " heading. */
export function extractChangelogSection(changelogText, tag) {
  const lines = String(changelogText).split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(`[${tag}]`));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** Parse Claude's stdout into {title, body}, tolerating a code fence. Null if invalid. */
export function parseClaudeNotice(stdout) {
  if (!stdout) return null;
  let s = String(stdout).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
  if (fence) s = fence[1].trim();
  try {
    const obj = JSON.parse(s);
    const title = typeof obj?.title === 'string' ? obj.title.trim() : '';
    const body = typeof obj?.body === 'string' ? obj.body.trim() : '';
    if (title && body) return { title, body };
    return null;
  } catch {
    return null;
  }
}

export function assembleNotice({ version, tag, title, body, publishedAt }) {
  return {
    id: `release-${version}`,
    title,
    body,
    publishedAt,
    severity: 'info',
    link: releaseUrl(tag),
    minAppVersion: version,
  };
}

export function prependNotice(feed, notice) {
  if (!Array.isArray(feed)) throw new Error('feed must be an array');
  if (feed.some((n) => n && n.id === notice.id)) {
    throw new Error(`Notice with id ${notice.id} already exists`);
  }
  return [notice, ...feed];
}
```

- [ ] **Step 4: Add the root test script**

In the root `package.json` `scripts` block, add:
```json
    "test:scripts": "node --test scripts/__tests__/",
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/__tests__/generate-release-notice.test.mjs`
Expected: PASS (all tests). Also `npm run test:scripts` from repo root passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-release-notice.mjs scripts/__tests__/generate-release-notice.test.mjs package.json
git commit -m "feat: pure logic for release-notice generation (refs #211)"
```

---

### Task 2: `main()` IO orchestration with graceful error handling

**Files:**
- Modify: `scripts/generate-release-notice.mjs` (append `main()` + a direct-run guard)

**Interfaces:**
- Consumes: the Task 1 pure functions.
- Produces: CLI `node scripts/generate-release-notice.mjs <version> <tag> [--stub-claude] [--dry-run]`.

- [ ] **Step 1: Append the IO layer**

Add to the top of `scripts/generate-release-notice.mjs` (imports):

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
```

Add these IO helpers and `main()` at the bottom:

```js
const NOTICES_PATH = 'docs/notices.json';
const CHANGELOG_PATH = 'CHANGELOG.md';

function buildPrompt(tag, section) {
  return [
    'You are drafting a short in-app "developer notice" for zmNinjaNg, shown to end users.',
    'Summarize what is new for a non-technical user in 2 to 4 short sentences.',
    'Rules: plain language, no jargon, no PR or issue numbers, no em-dashes, no marketing words (comprehensive, powerful, seamless, robust, etc.). First person is fine.',
    `End the body with this exact markdown link on its own line: [Full changelog](${releaseUrl(tag)})`,
    'Output ONLY a JSON object, no code fence, no prose: {"title": "...", "body": "..."}',
    'Keep the title under 60 characters.',
    '',
    `Changelog for ${tag}:`,
    section || '(no changelog section found)',
  ].join('\n');
}

/** Returns {title, body} or null. Never throws. Prints a reason on failure. */
function draftWithClaude(tag, section) {
  try {
    const out = execFileSync('claude', ['-p', buildPrompt(tag, section)], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = parseClaudeNotice(out);
    if (!parsed) console.error('Could not parse Claude output; using a link-only draft.');
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error('claude CLI not found on PATH; using a link-only draft you can edit.');
    } else {
      console.error(`claude -p failed (${err?.message ?? err}); using a link-only draft.`);
    }
    return null;
  }
}

function fallbackDraft(version, tag) {
  return {
    title: `zmNinjaNg ${version}`,
    body: `Here is what changed in this release: [Full changelog](${releaseUrl(tag)})`,
  };
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [version, tag] = args.filter((a) => !a.startsWith('--'));
  if (!version || !tag) {
    console.error('Usage: generate-release-notice.mjs <version> <tag> [--stub-claude] [--dry-run]');
    process.exit(0); // do not block the release
  }

  let section = '';
  try {
    section = extractChangelogSection(readFileSync(CHANGELOG_PATH, 'utf8'), tag);
  } catch {
    console.error(`Could not read ${CHANGELOG_PATH}; continuing with a link-only draft.`);
  }

  const draft = flags.has('--stub-claude')
    ? { title: `zmNinjaNg ${version}`, body: `Stub notice for ${version}. [Full changelog](${releaseUrl(tag)})` }
    : (draftWithClaude(tag, section) ?? fallbackDraft(version, tag));

  let notice = assembleNotice({
    version, tag, title: draft.title, body: draft.body,
    publishedAt: new Date().toISOString(),
  });

  console.log('\nProposed developer notice:\n');
  console.log(JSON.stringify(notice, null, 2));
  const choice = (await ask('\nAdd and push this notice? [y/N/e(dit)] ')).trim().toLowerCase();

  if (choice === 'e') {
    // Let the maintainer edit title/body via $EDITOR.
    const editor = process.env.EDITOR || 'vi';
    const tmp = `.notice-draft-${version}.json`;
    writeFileSync(tmp, JSON.stringify({ title: notice.title, body: notice.body }, null, 2));
    try {
      execFileSync(editor, [tmp], { stdio: 'inherit' });
      const edited = JSON.parse(readFileSync(tmp, 'utf8'));
      notice = assembleNotice({ version, tag, title: edited.title, body: edited.body, publishedAt: notice.publishedAt });
    } catch (err) {
      console.error(`Edit failed (${err?.message ?? err}); keeping the original draft.`);
    } finally {
      try { execFileSync('rm', ['-f', tmp]); } catch { /* ignore */ }
    }
  } else if (choice !== 'y') {
    console.log('Skipped adding a developer notice.');
    process.exit(0);
  }

  // Prepend and write.
  let feed;
  try {
    feed = JSON.parse(readFileSync(NOTICES_PATH, 'utf8'));
    feed = prependNotice(feed, notice);
  } catch (err) {
    console.error(`Could not update ${NOTICES_PATH} (${err?.message ?? err}); skipping notice.`);
    process.exit(0);
  }
  writeFileSync(NOTICES_PATH, JSON.stringify(feed, null, 2) + '\n');

  if (flags.has('--dry-run')) {
    console.log(`Dry run: wrote ${NOTICES_PATH} but did not commit or push.`);
    process.exit(0);
  }

  try {
    execFileSync('git', ['add', NOTICES_PATH], { stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', `chore: add release notice for ${version} (refs #211)`], { stdio: 'inherit' });
    execFileSync('git', ['push'], { stdio: 'inherit' });
    console.log('Developer notice committed and pushed.');
  } catch (err) {
    console.error(`git step failed (${err?.message ?? err}). The notice is written locally; commit it manually. Continuing the release.`);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 2: Manual dry-run (stubbed, no Claude, no git)**

Run: `node scripts/generate-release-notice.mjs 9.9.0 zmNinjaNg-9.9.0 --stub-claude --dry-run` and answer `y`.
Expected: prints an assembled notice with `id: "release-9.9.0"`, `severity: "info"`, `minAppVersion: "9.9.0"`, the release link; writes `docs/notices.json` then prints the dry-run message. Then restore the file: `git checkout -- docs/notices.json`.

- [ ] **Step 3: Verify the claude-not-found path is graceful**

Run (forcing ENOENT by hiding claude): `PATH=/usr/bin node scripts/generate-release-notice.mjs 9.9.0 zmNinjaNg-9.9.0 --dry-run` and answer `n`.
Expected: prints "claude CLI not found on PATH; using a link-only draft you can edit.", shows the link-only draft, and exits 0 without error on `n`. Restore: `git checkout -- docs/notices.json` if it changed.

- [ ] **Step 4: Re-run the unit tests (guard must not break exports)**

Run: `node --test scripts/__tests__/generate-release-notice.test.mjs`
Expected: PASS (the direct-run guard means importing the module does not call `main()`).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-release-notice.mjs
git commit -m "feat: release-notice IO orchestration with graceful claude fallback (refs #211)"
```

---

### Task 3: Wire into `make_release.sh`

**Files:**
- Modify: `scripts/make_release.sh` (insert between the CHANGELOG commit block and the tagging block, i.e. after the `--- Step 3: Generate changelog ---` block completes and before `--- Step 4: Tag ---`)

**Interfaces:**
- Consumes: `scripts/generate-release-notice.mjs` (Task 1/2); `$VERSION`, `$TAG` already set in the script.

- [ ] **Step 1: Insert the gated prompt**

In `scripts/make_release.sh`, immediately before the `# --- Step 4: Tag ---` line, add:

```bash
# --- Step 3.5: Optional developer notice (minor/major releases only) ---
NOTICE_PATCH=$(echo "$VERSION" | cut -d. -f3)
if [ "$NOTICE_PATCH" = "0" ]; then
    echo ""
    read -p "Generate a developer notice for this release? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        node scripts/generate-release-notice.mjs "$VERSION" "$TAG" \
            || echo "Notice generation skipped or failed; continuing with the release."
    fi
fi
```

The `|| echo ...` guard means even a hard failure in the node script does not
abort the release (`set -e` is active in this script).

- [ ] **Step 2: Syntax-check the script**

Run: `bash -n scripts/make_release.sh`
Expected: no output (valid syntax).

- [ ] **Step 3: Commit**

```bash
git add scripts/make_release.sh
git commit -m "feat: offer a release notice on minor/major releases (refs #211)"
```

---

### Task 4: Docs

**Files:**
- Modify: the developer guide's release/tooling chapter (confirm with grep)

- [ ] **Step 1: Document the flow**

Run from repo root: `grep -rln "make_release\|release\|CHANGELOG\|notices.json" docs/developer-guide`. In the release/tooling section (or a short new subsection), document: on a minor/major release `make_release.sh` offers to generate a developer notice; `scripts/generate-release-notice.mjs` uses `claude -p` to draft the text; the maintainer approves it (`y/N/edit`); it prepends to `docs/notices.json` with `minAppVersion` = the released version; and if `claude` is missing or fails, it falls back to a link-only draft and never blocks the release. Keep it plain and factual: no em-dashes, no banned superlatives.

- [ ] **Step 2: Lint docs**

Run from repo root on the edited file:
```bash
grep -niE "\b(comprehensive|robust|powerful|seamless|intuitive|user.friendly)\b" <file>
grep -n "—" <file>
```
Both zero. Fix any hits.

- [ ] **Step 3: Commit**

```bash
git add docs/developer-guide
git commit -m "docs: document release-notice automation (refs #211)"
```

---

### Task 5: Full verification pass

**Files:** none.

- [ ] **Step 1: Scripts unit tests** — `npm run test:scripts` from repo root (all pass).
- [ ] **Step 2: App test suite unaffected** — `cd app && npm test` (all pass; this change does not touch `app/`, so this is a regression sanity check).
- [ ] **Step 3: Script syntax** — `bash -n scripts/make_release.sh` (clean).
- [ ] **Step 4: Manual dry-run** — `node scripts/generate-release-notice.mjs 9.9.0 zmNinjaNg-9.9.0 --stub-claude --dry-run` (answer `y`), then `git checkout -- docs/notices.json`.
- [ ] **Step 5: State the verification result.** Delete this plan and the spec after the feature is confirmed complete.

---

## Notes for the implementer

- Never let a notice failure abort the release. Every IO failure path in
  `main()` calls `process.exit(0)` or catches and continues.
- `claude -p` is spawned with `execFileSync` (no shell), so the changelog text
  is passed as a single argument with no shell-quoting risk.
- The direct-run guard (`import.meta.url === pathToFileURL(process.argv[1]).href`)
  keeps `main()` from running when the test file imports the module.
- Do not touch `app/` source, the notice feed schema, or `create-release.yml`.
