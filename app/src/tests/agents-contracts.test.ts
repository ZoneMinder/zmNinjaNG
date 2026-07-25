import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const appSrc = path.resolve(repoRoot, 'app/src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceText = walk(appSrc)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

interface Contract {
  name: string;
  body: string;
}

function parseContracts(md: string): Contract[] {
  const section = md.split('## Architecture contracts')[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n### ')
    .slice(1)
    .map((block) => {
      const [name, ...rest] = block.split('\n');
      return { name: name.trim(), body: rest.join('\n') };
    });
}

function backtickTokens(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ''));
}

describe('AGENTS.project.md architecture contracts', () => {
  const projectFile = path.join(repoRoot, 'AGENTS.project.md');

  it('exists and holds at least 12 contracts with all four lines', () => {
    const md = fs.readFileSync(projectFile, 'utf8');
    const contracts = parseContracts(md);
    expect(contracts.length).toBeGreaterThanOrEqual(12);
    for (const c of contracts) {
      for (const field of ['Owns:', 'Path:', 'Never:', 'Gate:']) {
        expect(c.body, `${c.name} missing ${field}`).toContain(field);
      }
    }
  });

  it('every symbol and path named in Path/Gate lines exists', () => {
    const md = fs.readFileSync(projectFile, 'utf8');
    for (const c of parseContracts(md)) {
      const lines = c.body
        .split('\n')
        .filter((l) => l.startsWith('Path:') || l.startsWith('Gate:'));
      for (const token of lines.flatMap(backtickTokens)) {
        if (token.includes('/')) {
          expect(
            fs.existsSync(path.join(repoRoot, token)),
            `${c.name}: path ${token} missing`,
          ).toBe(true);
        } else {
          expect(
            sourceText.includes(token),
            `${c.name}: symbol ${token} not found in app/src`,
          ).toBe(true);
        }
      }
    }
  });
});
