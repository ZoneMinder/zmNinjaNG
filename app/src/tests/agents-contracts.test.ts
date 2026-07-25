import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const appSrc = path.resolve(repoRoot, 'app/src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
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
          const symbolPattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          expect(
            symbolPattern.test(sourceText),
            `${c.name}: symbol ${token} not found in app/src`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('AGENTS.md stays portable', () => {
  it('contains no project-specific tokens', () => {
    const core = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8').toLowerCase();
    const forbidden = [
      'zmNinja',
      'ZoneMinder',
      'zoneminder',
      'getProfileSettings',
      'useBandwidthSettings',
      'ErrorBanner',
      'agents/project',
      'Capacitor',
      'Zustand',
      'app/src',
    ];
    for (const token of forbidden) {
      expect(core.includes(token.toLowerCase()), `AGENTS.md contains "${token}"`).toBe(false);
    }
  });

  it('instruction files stay inside the token budget', () => {
    // These files load into every agent session (CLAUDE.md is the
    // Claude-only shim). Raising this budget is a deliberate act that needs
    // a reason in the commit message, like the lint ratchet (C7). Lowering
    // it is always welcome.
    const WORD_BUDGET = 1500;
    const words = (f: string) =>
      fs.readFileSync(path.join(repoRoot, f), 'utf8').split(/\s+/).filter(Boolean).length;
    const total = words('AGENTS.md') + words('AGENTS.project.md') + words('CLAUDE.md');
    expect(total, `combined ${total} words > budget ${WORD_BUDGET}`).toBeLessThanOrEqual(WORD_BUDGET);
  });
});

describe('developer docs reference valid rule IDs', () => {
  it('every "rule <id>" reference resolves', () => {
    const valid = new Set([
      ...['I1', 'I2', 'I3'],
      ...Array.from({ length: 10 }, (_, i) => `P${i + 1}`),
      ...Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
      ...Array.from({ length: 4 }, (_, i) => `M${i + 1}`),
    ]);
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const text = fs.readFileSync(path.join(guideDir, file), 'utf8');
      for (const m of text.matchAll(/\brules? ([IPCM]?[0-9]+)\b/gi)) {
        expect(valid.has(m[1].toUpperCase()), `${file}: unknown rule id "${m[1]}"`).toBe(true);
      }
    }
  });
});
