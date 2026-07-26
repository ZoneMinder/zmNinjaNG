import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
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
    const WORD_BUDGET = 2000;
    const words = (f: string) =>
      fs.readFileSync(path.join(repoRoot, f), 'utf8').split(/\s+/).filter(Boolean).length;
    const total = words('AGENTS.md') + words('AGENTS.project.md') + words('CLAUDE.md');
    expect(total, `combined ${total} words > budget ${WORD_BUDGET}`).toBeLessThanOrEqual(WORD_BUDGET);
  });
});

describe('knowledge files stay evidence-backed and private-data-free (M5)', () => {
  const knowledgeFiles = [
    'agents/project/domain-context.md',
    'agents/project/llm-models.md',
    'agents/generic/claude-workflows.md',
  ];

  it('every commit hash cited in domain-context exists in this repo', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'agents/project/domain-context.md'), 'utf8');
    const hashes = [...new Set([...md.matchAll(/\b[0-9a-f]{8}\b/g)].map((m) => m[0]))];
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(
        () => execSync(`git cat-file -e ${hash}^{commit}`, { cwd: repoRoot, stdio: 'pipe' }),
        `cited commit ${hash} not found in history`,
      ).not.toThrow();
    }
  });

  it('agent knowledge files contain no emails or IP addresses', () => {
    for (const file of knowledgeFiles) {
      const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(text, `${file} contains an IP address`).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(text, `${file} contains an email address`).not.toMatch(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/);
    }
  });
});

describe('prose stays in developer voice (P10)', () => {
  it('no rst or agent-playbook heading starts with "The "', () => {
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const lines = fs.readFileSync(path.join(guideDir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const next = lines[i + 1] ?? '';
        const isHeading = /^[=\-~^"]{3,}\s*$/.test(next) && next.trim().length >= line.trim().length - 2;
        if (isHeading && /^The /.test(line)) offenders.push(`${file}:${i + 1} ${line}`);
      });
    }
    for (const dir of ['agents/generic', 'agents/project']) {
      const full = path.join(repoRoot, dir);
      for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.md'))) {
        fs.readFileSync(path.join(full, file), 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/^#+ The /.test(line)) offenders.push(`${dir}/${file}:${i + 1} ${line}`);
          });
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});

describe('developer docs reference valid rule IDs', () => {
  it('every "rule <id>" reference resolves', () => {
    // Derived from AGENTS.md so adding or removing a rule cannot desync
    // this set (it did once, when M5 landed without a matching update).
    const core = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const valid = new Set([...core.matchAll(/^- ([IPCM][0-9]+)\./gm)].map((m) => m[1]));
    expect(valid.size).toBeGreaterThanOrEqual(20);
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const text = fs.readFileSync(path.join(guideDir, file), 'utf8');
      for (const m of text.matchAll(/\brules? ([IPCM]?[0-9]+)\b/gi)) {
        expect(valid.has(m[1].toUpperCase()), `${file}: unknown rule id "${m[1]}"`).toBe(true);
      }
    }
  });
});
