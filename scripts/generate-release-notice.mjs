/**
 * Generate an in-app developer notice for a minor/major release (refs #211).
 * Pure helpers are exported for tests; main() does the IO and is guarded so it
 * only runs when the file is executed directly.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

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
    try {
      writeFileSync(tmp, JSON.stringify({ title: notice.title, body: notice.body }, null, 2));
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
    writeFileSync(NOTICES_PATH, JSON.stringify(feed, null, 2) + '\n');
  } catch (err) {
    console.error(`Could not write ${NOTICES_PATH} (${err?.message ?? err}); skipping notice.`);
    process.exit(0);
  }

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
  main().catch((err) => {
    console.error(`Unexpected error: ${err?.message ?? err}; release continues.`);
    process.exit(0);
  });
}
