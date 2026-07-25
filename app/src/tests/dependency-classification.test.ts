/**
 * Keeps `package.json` honest about what ships (AGENTS.md rule 37).
 *
 * Vite bundles whatever it can resolve, so a runtime import declared under
 * `devDependencies` builds and tests clean. The manifest is still wrong, and
 * the two directions fail in different places: a runtime package filed as dev
 * breaks `npm ci --omit=dev`, and dev tooling filed as runtime counts against
 * the shipped tree's advisories (both were true on this branch before #281).
 *
 * The rule this enforces is only the first direction, because it is the one a
 * script can decide: anything imported by shipped source belongs in
 * `dependencies`. The reverse needs a human to say whether an unimported
 * package is dead or loaded some other way.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const PACKAGE_JSON = join(__dirname, '../../package.json');

/** Test-only source. Its imports may legitimately be dev dependencies. */
const isTestFile = (path: string): boolean =>
  path.includes('__tests__') ||
  path.includes(`${join('src', 'tests')}`) ||
  /\.test\.tsx?$/.test(path);

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !isTestFile(path)) out.push(path);
  }
  return out;
};

/** `@scope/pkg/sub` -> `@scope/pkg`; `pkg/sub` -> `pkg`; relative -> null. */
const packageOf = (specifier: string): string | null => {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g;

describe('dependency classification', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const files = sourceFiles(SRC);

  it('finds the shipped source to scan', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(Object.keys(pkg.devDependencies).length).toBeGreaterThan(0);
  });

  it('declares every package the shipped source imports as a runtime dependency', () => {
    const dev = new Set(Object.keys(pkg.devDependencies));
    const offenders = new Map<string, string>();

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(IMPORT_RE)) {
        const name = packageOf(match[1]);
        if (name && dev.has(name) && !offenders.has(name)) {
          offenders.set(name, file.slice(SRC.length + 1));
        }
      }
    }

    expect(
      [...offenders].map(([name, file]) => `${name} (imported by src/${file})`)
    ).toEqual([]);
  });
});
