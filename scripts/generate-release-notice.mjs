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
