/**
 * Generate an in-app developer notice for a release, and recommend the semver
 * bump for that release (refs #211, #214). Both come from a single `claude -p`
 * call fed the closed issues since the last release (via
 * github_changelog_generator). Pure helpers are exported for tests; main() does
 * the IO and is guarded so it only runs when the file is executed directly.
 *
 * Modes:
 *   generate_notice.mjs [version]                 draft + prompt + write notice (own claude call)
 *   generate_notice.mjs --plan --version V [--cache F]
 *                                                 analyze closed issues, print the
 *                                                 recommended bump, cache the draft.
 *                                                 Best-effort: any failure prints a
 *                                                 warning and an empty RECOMMENDED_BUMP,
 *                                                 exits 0 so a release never blocks on it.
 *   generate_notice.mjs --write --version V --cache F
 *                                                 write the notice from a cached --plan
 *                                                 draft. No claude call.
 *
 * Changelog source: github_changelog_generator (via bundle exec). In the default
 * and --write notice paths any tool failure (gh, bundle/gcg, claude, unparseable
 * output, corrupt JSON) exits non-zero. Declining the draft exits 0. --plan is
 * the only best-effort path.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'ZoneMinder/zmNinjaNg';

/** The three semver bump levels Claude may recommend. */
export const VALID_BUMPS = ['major', 'minor', 'patch'];

export function parseVersionParts(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!m) throw new Error(`Unparseable version: ${version}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Apply a semver bump to a version string. major/minor zero the lower fields. */
export function bumpVersion(version, bump) {
  const { major, minor, patch } = parseVersionParts(version);
  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Invalid bump: ${bump}`);
  }
}

export function isFeatureRelease(version) {
  return parseVersionParts(version).patch === 0;
}

export function releaseUrl(tag) {
  return `https://github.com/${REPO}/releases/tag/${tag}`;
}

/** Return the "## [tag]..." section from changelog text up to the next "## " heading. */
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

/**
 * Parse Claude's stdout into {title, body, bump, bumpReason}, tolerating a code
 * fence. Null if title/body are missing. bump is null unless it is one of
 * VALID_BUMPS, so a malformed bump degrades to the caller's default rather than
 * blocking.
 */
export function parseClaudeNotice(stdout) {
  if (!stdout) return null;
  let s = String(stdout).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
  if (fence) s = fence[1].trim();
  try {
    const obj = JSON.parse(s);
    const title = typeof obj?.title === 'string' ? obj.title.trim() : '';
    const body = typeof obj?.body === 'string' ? obj.body.trim() : '';
    const bump = VALID_BUMPS.includes(obj?.bump) ? obj.bump : null;
    const bumpReason = typeof obj?.bumpReason === 'string' ? obj.bumpReason.trim() : '';
    if (title && body) return { title, body, bump, bumpReason };
    return null;
  } catch {
    return null;
  }
}

export function assembleNotice({ version, tag, title, body, publishedAt }) {
  const link = releaseUrl(tag);
  // The changelog link is appended here, not by Claude, so it always points at
  // the final release tag even when the draft was made before a version bump.
  const bodyWithLink = body.includes('[Full changelog]')
    ? body
    : `${body}\n\n[Full changelog](${link})`;
  return {
    id: `release-${version}`,
    title,
    body: bodyWithLink,
    publishedAt,
    severity: 'info',
    link,
    minAppVersion: version,
  };
}

/** Build the release tag for a version, e.g. "1.2.0" -> "zmNinjaNg-1.2.0". */
export function deriveTag(version) {
  return `zmNinjaNg-${version}`;
}

/** Replace an existing notice with the same id (moving it to the front with its
 *  new content), or prepend it if absent. Used for regeneration. */
export function upsertNotice(feed, notice) {
  if (!Array.isArray(feed)) throw new Error('feed must be an array');
  const without = feed.filter((n) => !(n && n.id === notice.id));
  return [notice, ...without];
}

const NOTICES_PATH = 'docs/notices.json';

function buildPrompt(tag, section) {
  return [
    'You are drafting a short in-app "developer notice" for zmNinjaNg shown to end users, and classifying the release version bump.',
    'List the changes a user would actually notice or benefit from, as a markdown bullet list. Each bullet starts with "- " on its own line and describes one change in plain terms. Include new features, visible improvements, and fixes to things users interact with. Skip anything a user would not notice: internal refactors, build or CI changes, dependency updates, test changes, and store-compliance or permission changes (for example, removing an Android permission to satisfy Google Play).',
    'Rules: plain language, no jargon, no PR or issue numbers, no em-dashes, no marketing words (comprehensive, powerful, seamless, robust, etc.). Do not use first person (no "I added", "I fixed"); state each change as a plain fact, for example "Fixed the Android back button".',
    'Also classify the semantic version bump for this release. "bump" is "major" if any change is breaking or forces users to reconfigure, "minor" if there is any new feature or user-facing enhancement, otherwise "patch". "bumpReason" is one short sentence naming the change that drove the choice.',
    'Do not add any changelog link; it is appended automatically.',
    'Output ONLY a JSON object, no code fence, no prose: {"title": "...", "body": "...", "bump": "minor", "bumpReason": "..."}',
    'Keep the title under 60 characters.',
    '',
    `Changelog (closed issues) for ${tag}:`,
    section || '(no changelog section found)',
  ].join('\n');
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

function readArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** gh auth token, or throw. */
function getToken() {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('gh CLI not available or not authenticated');
  }
}

/**
 * Run github_changelog_generator for the tag and return the tag's changelog
 * section (the closed issues since the last release). Throws on any failure.
 * Subprocess chatter is routed to stderr (fd 2) so stdout stays clean for the
 * --plan machine-readable lines.
 */
function collectChangelogSection(version, token) {
  const tag = deriveTag(version);
  const tmp = join(tmpdir(), `notice-changelog-${version}.md`);
  try {
    execFileSync(
      'bundle',
      ['exec', 'github_changelog_generator', '--future-release', tag, '-o', tmp],
      { env: { ...process.env, CHANGELOG_GITHUB_TOKEN: token }, stdio: ['ignore', 2, 2] }
    );
  } catch {
    throw new Error('github_changelog_generator is not available or failed');
  }
  let changelogText;
  try {
    changelogText = readFileSync(tmp, 'utf8');
  } catch {
    throw new Error('github_changelog_generator did not write the expected output file');
  } finally {
    rmSync(tmp, { force: true });
  }
  const section = extractChangelogSection(changelogText, tag);
  if (!section) throw new Error(`No changelog entries found for ${version}`);
  return section;
}

/** One claude -p call: notice draft + bump recommendation. Throws on failure. */
function draftWithClaude(tag, section) {
  let out;
  try {
    out = execFileSync('claude', ['-p', buildPrompt(tag, section)], {
      encoding: 'utf8',
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('claude CLI not found on PATH');
    throw new Error(`claude -p failed (${err?.message ?? err})`);
  }
  const parsed = parseClaudeNotice(out);
  if (!parsed) throw new Error('could not parse claude output');
  return parsed;
}

function readFeed() {
  try {
    const raw = readFileSync(NOTICES_PATH, 'utf8');
    const feed = JSON.parse(raw);
    if (!Array.isArray(feed)) return [];
    return feed;
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw new Error(`Could not read ${NOTICES_PATH} (${err?.message ?? err}); not overwriting.`);
  }
}

/** Show the assembled notice, allow edit, and write it into the feed. */
async function writeNoticeInteractive(draft, version) {
  const tag = deriveTag(version);
  const feed = readFeed();
  let notice = assembleNotice({
    version, tag, title: draft.title, body: draft.body,
    publishedAt: new Date().toISOString(),
  });

  console.log('\nProposed developer notice:\n');
  console.log(JSON.stringify(notice, null, 2));
  const choice = (await ask('\nAdd this notice? [y/N/e(dit)] ')).trim().toLowerCase();

  if (choice === 'e') {
    const editor = process.env.EDITOR || 'vi';
    const editTmp = join(tmpdir(), `notice-draft-${version}.json`);
    try {
      writeFileSync(editTmp, JSON.stringify({ title: notice.title, body: notice.body }, null, 2));
      execFileSync(editor, [editTmp], { stdio: 'inherit' });
      const edited = JSON.parse(readFileSync(editTmp, 'utf8'));
      notice = assembleNotice({ version, tag, title: edited.title, body: edited.body, publishedAt: notice.publishedAt });
    } catch (err) {
      console.error(`Edit failed (${err?.message ?? err}); keeping the original draft.`);
    } finally {
      rmSync(editTmp, { force: true });
    }
  } else if (choice !== 'y') {
    console.log('Skipped.');
    process.exit(0);
  }

  const updated = upsertNotice(feed, notice);
  writeFileSync(NOTICES_PATH, JSON.stringify(updated, null, 2) + '\n');
  console.log('Wrote docs/notices.json.');
}

/**
 * --plan: analyze closed issues, recommend a bump, cache the draft. Best-effort.
 * Human-readable progress goes to stderr; only the KEY=VALUE result lines go to
 * stdout so the caller can capture them. Any failure prints a warning and an
 * empty RECOMMENDED_BUMP, then exits 0: a version suggestion must never block a
 * release.
 */
function runPlan(args) {
  const version = readArg(args, '--version');
  const cachePath = readArg(args, '--cache');
  try {
    if (!version) throw new Error('--plan requires --version');
    console.error(`Analyzing closed issues since the last release (for ${version})...`);
    const token = getToken();
    const section = collectChangelogSection(version, token);
    console.error('Asking Claude to classify the release and draft the notice...');
    const parsed = draftWithClaude(deriveTag(version), section);
    const bump = parsed.bump ?? 'patch';
    if (!parsed.bump) {
      console.error('Claude did not return a valid bump; defaulting the suggestion to patch.');
    }
    const suggested = bumpVersion(version, bump);
    if (cachePath) {
      writeFileSync(cachePath, JSON.stringify({
        title: parsed.title, body: parsed.body, bump: parsed.bump, bumpReason: parsed.bumpReason,
      }));
      console.error(`Cached the notice draft at ${cachePath}.`);
    }
    console.error(`\nClaude recommends a ${bump.toUpperCase()} release: ${version} -> ${suggested}`);
    if (parsed.bumpReason) console.error(`  reason: ${parsed.bumpReason}`);
    console.log(`RECOMMENDED_BUMP=${bump}`);
    console.log(`SUGGESTED_VERSION=${suggested}`);
    console.log(`BUMP_REASON=${(parsed.bumpReason || '').replace(/\s+/g, ' ').trim()}`);
    process.exit(0);
  } catch (err) {
    console.error(`\nCould not get a version suggestion from Claude: ${err?.message ?? err}`);
    console.error('Falling back to the default bump. The release is not blocked.');
    console.log('RECOMMENDED_BUMP=');
    process.exit(0);
  }
}

/** --write: assemble and write the notice from a cached --plan draft. No claude. */
async function runWrite(args) {
  const version = readArg(args, '--version');
  const cachePath = readArg(args, '--cache');
  if (!version) { console.error('--write requires --version'); process.exit(1); }
  if (!cachePath) { console.error('--write requires --cache'); process.exit(1); }
  let draft;
  try {
    draft = JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch (err) {
    console.error(`Could not read cached draft at ${cachePath} (${err?.message ?? err}).`);
    process.exit(1);
  }
  if (!draft?.title || !draft?.body) {
    console.error('Cached draft is missing title/body.');
    process.exit(1);
  }
  await writeNoticeInteractive(draft, version);
  process.exit(0);
}

/** Default mode: draft with a fresh claude call, then prompt and write. */
async function runDefault(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  let version = positional[0];
  if (!version) {
    let defaultVersion = '';
    try {
      const pkg = JSON.parse(readFileSync('app/package.json', 'utf8'));
      defaultVersion = pkg.version ?? '';
    } catch { /* no default available */ }
    version = (await ask(`Version [${defaultVersion}]: `)).trim() || defaultVersion;
  }
  if (!version) {
    console.error('No version given.');
    process.exit(1);
  }

  // Fail before the slow steps if the feed is corrupt.
  readFeed();

  let token;
  try {
    token = getToken();
  } catch (err) {
    console.error(`${err?.message ?? err}; cannot generate notice.`);
    process.exit(1);
  }

  console.log(`Collecting closed issues for ${deriveTag(version)} (this can take a moment)...`);
  let section;
  try {
    section = collectChangelogSection(version, token);
  } catch (err) {
    console.error(`${err?.message ?? err}; cannot generate notice.`);
    process.exit(1);
  }

  console.log('\nAsking Claude to summarize the changes (this can take a minute)...');
  let draft;
  try {
    draft = draftWithClaude(deriveTag(version), section);
  } catch (err) {
    console.error(`${err?.message ?? err}; cannot generate notice.`);
    process.exit(1);
  }

  await writeNoticeInteractive(draft, version);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--plan')) return runPlan(args);
  if (args.includes('--write')) return runWrite(args);
  return runDefault(args);
}

// Direct-run guard. Unexpected errors exit 1.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
}
