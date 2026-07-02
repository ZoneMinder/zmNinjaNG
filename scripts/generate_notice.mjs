/**
 * Generate an in-app developer notice for a minor/major release (refs #211).
 * Pure helpers are exported for tests; main() does the IO and is guarded so it
 * only runs when the file is executed directly.
 *
 * Changelog source: github_changelog_generator (via bundle exec). No fallbacks.
 * Any tool failure (gh, bundle/gcg, claude, unparseable output, corrupt JSON)
 * exits non-zero. Declining the draft exits 0.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    'You are drafting a short in-app "developer notice" for zmNinjaNg, shown to end users.',
    'Summarize what is new for a non-technical user as a short markdown bullet list of 2 to 5 bullets. Each bullet starts with "- " on its own line and describes one change in plain terms.',
    'Rules: plain language, no jargon, no PR or issue numbers, no em-dashes, no marketing words (comprehensive, powerful, seamless, robust, etc.). First person is fine.',
    `After the bullets, add a blank line, then this exact markdown link on its own line: [Full changelog](${releaseUrl(tag)})`,
    'Output ONLY a JSON object, no code fence, no prose: {"title": "...", "body": "..."}',
    'Keep the title under 60 characters.',
    '',
    `Changelog for ${tag}:`,
    section || '(no changelog section found)',
  ].join('\n');
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));

  // 1. Resolve version: positional arg, or prompt with app/package.json default.
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

  // 2. Derive tag.
  const tag = deriveTag(version);

  // 3. Get GitHub token. Exit 1 if gh is missing or not authenticated.
  let token;
  try {
    token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('gh CLI not available or not authenticated; cannot generate notice.');
    process.exit(1);
  }

  // 4. Run github_changelog_generator into a temp file. Do NOT touch CHANGELOG.md.
  const tmp = join(tmpdir(), `notice-changelog-${version}.md`);
  try {
    execFileSync(
      'bundle',
      ['exec', 'github_changelog_generator', '--future-release', tag, '-o', tmp],
      { env: { ...process.env, CHANGELOG_GITHUB_TOKEN: token }, stdio: ['ignore', 'inherit', 'inherit'] }
    );
  } catch {
    console.error('github_changelog_generator is not available or failed; cannot generate notice.');
    process.exit(1);
  }

  // 5. Extract the version section, then delete the temp file.
  const section = extractChangelogSection(readFileSync(tmp, 'utf8'), tag);
  rmSync(tmp, { force: true });
  if (!section) {
    console.error(`No changelog entries found for ${version}.`);
    process.exit(1);
  }

  // 6. Draft with claude. All failure modes exit 1.
  let out;
  try {
    out = execFileSync('claude', ['-p', buildPrompt(tag, section)], {
      encoding: 'utf8',
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error('claude CLI not found on PATH; cannot generate notice.');
    } else {
      console.error(`claude -p failed (${err?.message ?? err}); cannot generate notice.`);
    }
    process.exit(1);
  }
  const parsed = parseClaudeNotice(out);
  if (!parsed) {
    console.error('Could not parse claude output; cannot generate notice.');
    process.exit(1);
  }

  // 7. Assemble the notice object.
  let notice = assembleNotice({
    version, tag, title: parsed.title, body: parsed.body,
    publishedAt: new Date().toISOString(),
  });

  // 8. Show and ask.
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

  // 9. Read notices.json (ENOENT = start fresh), upsert, write. No git.
  let feed = [];
  try {
    const raw = readFileSync(NOTICES_PATH, 'utf8');
    try {
      feed = JSON.parse(raw);
      if (!Array.isArray(feed)) feed = [];
    } catch {
      console.error(`${NOTICES_PATH} exists but is not valid JSON; not overwriting.`);
      process.exit(1);
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`Could not read ${NOTICES_PATH} (${err?.message ?? err}); not overwriting.`);
      process.exit(1);
    }
    // ENOENT: start with empty feed.
  }

  feed = upsertNotice(feed, notice);
  writeFileSync(NOTICES_PATH, JSON.stringify(feed, null, 2) + '\n');
  console.log('Wrote docs/notices.json.');
  process.exit(0);
}

// 10. Direct-run guard. Unexpected errors now exit 1.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
}
