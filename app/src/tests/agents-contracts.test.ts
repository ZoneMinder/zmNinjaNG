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

function srcFiles(): string[] {
  return walk(appSrc);
}

function read(f: string): string {
  return fs.readFileSync(f, 'utf8');
}

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

describe('developer docs cite symbols, not line numbers', () => {
  it('no rst file carries a file.ts:NN citation', () => {
    // Line numbers rot silently as code moves; symbol names are greppable
    // and survive edits. GitHub source links pin lines with #LNN, which
    // this pattern does not match.
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      fs.readFileSync(path.join(guideDir, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\.(ts|tsx):\d+/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders, `line-number citations found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no mermaid block contains a semicolon', () => {
    // Mermaid parses ";" as a statement separator, so a semicolon inside a
    // message label truncates the statement and the whole diagram renders as
    // "Syntax error in text" on readthedocs.
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const lines = fs.readFileSync(path.join(guideDir, file), 'utf8').split('\n');
      let inMermaid = false;
      lines.forEach((line, i) => {
        if (/^\s*\.\. mermaid::/.test(line)) {
          inMermaid = true;
          return;
        }
        if (inMermaid && line.trim() && !/^\s/.test(line)) inMermaid = false;
        if (inMermaid && line.includes(';')) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, `semicolons inside mermaid blocks:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('Sessions contract', () => {
  // ApiClient is built either directly (createApiClient, api/client.ts) or
  // via its store-wired wrapper (createStoreApiClient, api/store-gates.ts).
  // Sanctioned callers, per grep evidence (refs #337):
  //  - api/store-gates.ts    the gate factory; sole caller of createApiClient
  //  - services/sessions.ts  the live per-profile session registry
  //  - services/discovery.ts, pages/ProfileForm.tsx
  //                          pre-save probe flows: build a client for an
  //                          un-saved profile before it has a session
  const SANCTIONED = [
    'api/store-gates.ts',
    'services/sessions.ts',
    'services/discovery.ts',
    'pages/ProfileForm.tsx',
  ];

  it('ApiClient is constructed only in sanctioned files', () => {
    const offenders = srcFiles().filter(
      (f) =>
        !SANCTIONED.some((ok) => f.endsWith(ok)) &&
        !f.includes('__tests__') &&
        !f.endsWith('api/client.ts') &&
        /\bcreate(?:Store)?ApiClient\s*\(/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('the deleted singleton stays deleted', () => {
    const offenders = srcFiles().filter((f) => /\b(getApiClient|setApiClient)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the profile-id sentinels and the virtual prefix live only beside the brand', () => {
    // The virtual prefix joins the two sentinels here: it is the shape
    // isVirtualProfileId/isAggregateProfileId test for, so a second copy of
    // the literal is a second definition of what "aggregate" means. Callers
    // import the helpers instead, and mint ids with mintVirtualProfileId().
    //
    // The prefix match is open-ended, unlike the two sentinels: those are
    // whole ids, but this is a prefix, so '__virtual_legacy' hand-written
    // anywhere is the same second definition and has to be caught too.
    // Refs #337.
    const offenders = srcFiles().filter(
      (f) =>
        (read(f).includes("'__all_profiles__'") ||
          read(f).includes("'__probe__'") ||
          /['"`]__virtual_/.test(read(f))) &&
        !f.endsWith('api/types.ts'),
    );
    expect(offenders).toEqual([]);
  });

  it('stores/auth.ts never statically imports services/sessions.ts', () => {
    // sessions.ts injects a gate instead (see its file header) precisely to
    // avoid this cycle; a static import here would reintroduce it.
    const authFile = srcFiles().find((f) => f.endsWith('stores/auth.ts'))!;
    expect(/from\s+['"][^'"]*services\/sessions['"]/.test(read(authFile))).toBe(false);
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

/**
 * Localization contract, mechanical half: a translated string may say anything
 * it likes, but it has to interpolate the same values `en` does.
 *
 * A dropped or renamed `{{param}}` is invisible to the existing key gate,
 * which only checks that keys exist. The string still renders - it just
 * renders without the monitor name, the count, or the server it was about, in
 * one language only, which nobody reviewing an English diff would notice.
 */
describe('Localization contract', () => {
  const localesDir = path.join(appSrc, 'locales');

  /** Every leaf string, keyed by its dotted path. */
  function flatten(node: unknown, prefix = '', acc = new Map<string, string>()): Map<string, string> {
    if (typeof node === 'string') {
      acc.set(prefix, node);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        flatten(value, prefix ? `${prefix}.${key}` : key, acc);
      }
    }
    return acc;
  }

  /** Names only: `{{count}}` and `{{count, number}}` are the same parameter. */
  function placeholders(text: string): Set<string> {
    return new Set([...text.matchAll(/\{\{\s*([^}\s,]+)/g)].map((m) => m[1]));
  }

  function load(locale: string): Map<string, string> {
    return flatten(JSON.parse(read(path.join(localesDir, locale, 'translation.json'))));
  }

  it('every locale interpolates the same values as en, key for key', () => {
    const en = load('en');
    // 1380 today. A floor with real slack in it would let a partial parse
    // through and report parity over a handful of keys.
    expect(en.size).toBeGreaterThan(1000);

    const others = fs
      .readdirSync(localesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'en' && e.name !== '__tests__')
      .map((e) => e.name);
    expect(others.length).toBeGreaterThanOrEqual(4);

    const mismatches: string[] = [];
    for (const locale of others) {
      for (const [key, text] of load(locale)) {
        const enText = en.get(key);
        // Keys en does not have are the key gate's business, not this one.
        if (enText === undefined) continue;
        const expected = placeholders(enText);
        const actual = placeholders(text);
        const missing = [...expected].filter((p) => !actual.has(p));
        const extra = [...actual].filter((p) => !expected.has(p));
        if (missing.length || extra.length) {
          const parts = [
            missing.length ? `missing ${missing.map((p) => `{{${p}}}`).join(', ')}` : '',
            extra.length ? `unexpected ${extra.map((p) => `{{${p}}}`).join(', ')}` : '',
          ].filter(Boolean);
          mismatches.push(`${locale}: ${key} - ${parts.join(', ')}`);
        }
      }
    }

    expect(mismatches, `Placeholder drift against en:\n${mismatches.join('\n')}`).toEqual([]);
  });
});
