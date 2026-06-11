/**
 * Enforces AGENTS.md rule 1: no em-dashes in source or developer docs.
 * Scans app/src ts/tsx files (excluding src/locales and this file) and
 * docs/developer-guide rst files, failing with a list of offenders.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const EM_DASH = '—';
const thisFile = fileURLToPath(import.meta.url);
const srcDir = path.resolve(path.dirname(thisFile), '..');
const docsDir = path.resolve(path.dirname(thisFile), '../../../docs/developer-guide');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales' || entry.name === 'node_modules') continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && full !== thisFile) {
      out.push(full);
    }
  }
  return out;
}

function findOffenders(files: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH)) {
        offenders.push(`${path.relative(srcDir, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return offenders;
}

describe('no em-dash characters', () => {
  it('app/src ts/tsx files are free of em-dashes', () => {
    const offenders = findOffenders(collectSourceFiles(srcDir));
    expect(offenders, `Em-dashes found (replace per AGENTS.md rule 1):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('docs/developer-guide rst files are free of em-dashes', () => {
    const files = fs
      .readdirSync(docsDir)
      .filter((f) => f.endsWith('.rst'))
      .map((f) => path.join(docsDir, f));
    expect(files.length).toBeGreaterThan(0);
    const offenders = findOffenders(files);
    expect(offenders, `Em-dashes found (replace per AGENTS.md rule 1):\n${offenders.join('\n')}`).toEqual([]);
  });
});
