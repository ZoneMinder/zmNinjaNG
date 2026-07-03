import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersionParts, isFeatureRelease, releaseUrl,
  extractChangelogSection, parseClaudeNotice, assembleNotice,
  deriveTag, upsertNotice, bumpVersion, VALID_BUMPS,
} from '../generate_notice.mjs';

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

test('parseClaudeNotice parses bare JSON, bump defaults to null', () => {
  assert.deepEqual(
    parseClaudeNotice('{"title":"T","body":"B"}'),
    { title: 'T', body: 'B', bump: null, bumpReason: '' }
  );
});

test('parseClaudeNotice strips a code fence', () => {
  assert.deepEqual(
    parseClaudeNotice('```json\n{"title":"T","body":"B"}\n```'),
    { title: 'T', body: 'B', bump: null, bumpReason: '' }
  );
});

test('parseClaudeNotice reads a valid bump and reason', () => {
  assert.deepEqual(
    parseClaudeNotice('{"title":"T","body":"B","bump":"minor","bumpReason":"adds a feature"}'),
    { title: 'T', body: 'B', bump: 'minor', bumpReason: 'adds a feature' }
  );
});

test('parseClaudeNotice rejects an out-of-range bump to null', () => {
  const parsed = parseClaudeNotice('{"title":"T","body":"B","bump":"huge"}');
  assert.equal(parsed.bump, null);
});

test('parseClaudeNotice returns null on garbage or missing title/body', () => {
  assert.equal(parseClaudeNotice('not json at all'), null);
  assert.equal(parseClaudeNotice('{"title":""}'), null);
  assert.equal(parseClaudeNotice(''), null);
});

test('VALID_BUMPS lists the three semver levels', () => {
  assert.deepEqual([...VALID_BUMPS].sort(), ['major', 'minor', 'patch']);
});

test('bumpVersion advances the right field and zeroes the rest', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.2.3', 'nope'));
});

test('assembleNotice sets script-owned fields and appends the changelog link', () => {
  const n = assembleNotice({
    version: '1.2.0', tag: 'zmNinjaNg-1.2.0',
    title: 'T', body: 'B', publishedAt: '2026-07-01T00:00:00Z',
  });
  assert.equal(n.id, 'release-1.2.0');
  assert.equal(n.severity, 'info');
  assert.equal(n.minAppVersion, '1.2.0');
  assert.equal(n.link, 'https://github.com/ZoneMinder/zmNinjaNg/releases/tag/zmNinjaNg-1.2.0');
  assert.equal(n.title, 'T');
  assert.equal(n.body, 'B\n\n[Full changelog](https://github.com/ZoneMinder/zmNinjaNg/releases/tag/zmNinjaNg-1.2.0)');
  assert.equal(n.publishedAt, '2026-07-01T00:00:00Z');
});

test('assembleNotice does not double the changelog link if body already has one', () => {
  const body = 'B\n\n[Full changelog](https://example.com)';
  const n = assembleNotice({
    version: '1.2.0', tag: 'zmNinjaNg-1.2.0', title: 'T', body, publishedAt: '2026-07-01T00:00:00Z',
  });
  assert.equal(n.body, body);
});

test('deriveTag builds the tag', () => {
  assert.equal(deriveTag('1.2.0'), 'zmNinjaNg-1.2.0');
});

test('upsertNotice replaces an existing id and moves it to the front', () => {
  const feed = [{ id: 'a' }, { id: 'release-1.2.0', body: 'old' }, { id: 'b' }];
  const out = upsertNotice(feed, { id: 'release-1.2.0', body: 'new' });
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 'release-1.2.0');
  assert.equal(out[0].body, 'new');
  assert.equal(out.filter((n) => n.id === 'release-1.2.0').length, 1);
});

test('upsertNotice prepends when the id is absent', () => {
  const out = upsertNotice([{ id: 'a' }], { id: 'release-9.9.9' });
  assert.equal(out[0].id, 'release-9.9.9');
  assert.equal(out.length, 2);
});
