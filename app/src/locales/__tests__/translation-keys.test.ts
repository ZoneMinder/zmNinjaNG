/**
 * Guards against the two ways translations rot silently.
 *
 * i18n.ts sets `fallbackLng: 'en'`, so a key missing from de/es/fr/zh renders
 * the English string in the middle of a translated screen, and a key missing
 * from en renders the raw key id at the user ("events.duration"). Neither
 * throws, and no CI job caught either until these tests existed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import en from '../en/translation.json';
import de from '../de/translation.json';
import es from '../es/translation.json';
import fr from '../fr/translation.json';
import zh from '../zh/translation.json';

type Tree = { [key: string]: string | Tree };

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every leaf path in a translation tree, e.g. "events.duration". */
function leafPaths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`)
  );
}

/**
 * i18next resolves `foo.count` against `count_one` / `count_other` when the
 * caller passes a count, so a plural family satisfies a bare key reference.
 */
function resolves(tree: Tree, path: string): boolean {
  const parts = path.split('.');
  const leaf = parts.pop() as string;
  let node: Tree | string = tree;
  for (const part of parts) {
    if (typeof node === 'string' || !(part in node)) return false;
    node = node[part];
  }
  if (typeof node === 'string') return false;
  return leaf in node || Object.keys(node).some((k) => k.startsWith(`${leaf}_`));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' || entry === 'locales' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Literal keys passed to t(). Dynamic keys (t(someVar)) are out of reach. */
const T_CALL = /\bt\(\s*['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g;

describe('translation keys', () => {
  it('every t() key in the source resolves against en', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(T_CALL)) {
        if (!resolves(en as Tree, match[1])) missing.push(`${match[1]} (${file.slice(SRC.length + 1)})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it.each([
    ['de', de],
    ['es', es],
    ['fr', fr],
    ['zh', zh],
  ])('%s has exactly the keys en has', (_lang, tree) => {
    const expected = leafPaths(en as Tree).sort();
    expect(leafPaths(tree as Tree).sort()).toEqual(expected);
  });
});
