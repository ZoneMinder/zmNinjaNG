import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersionParts, isFeatureRelease, releaseUrl,
  extractChangelogSection, parseClaudeNotice, assembleNotice, prependNotice,
  deriveTag, upsertNotice,
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
