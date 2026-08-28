#!/usr/bin/env node
/**
 * Test-quality and vocabulary ratchet.
 *
 * Three rules in AGENTS.md and the playbooks were review-only and drifted,
 * as M1 predicts: C6 (assertions must be able to fail) had 302 existence-only
 * assertions; the testing playbook's seam guidance had 121 test files mocking
 * the app's own stores, hooks, services, or components instead of testing
 * through them; the glossary's avoided terms kept appearing in prose. Like
 * the lint ratchet (refs #281), this records each count in
 * `.quality-baseline.json` and fails when one grows. Lowering is welcome;
 * raising needs a reason in the commit message (C7).
 *
 *   node scripts/quality-ratchet.mjs            print counts
 *   node scripts/quality-ratchet.mjs --update   rewrite the baseline
 *
 * `src/tests/quality-ratchet.test.ts` imports `currentCounts` and compares,
 * so the vitest suite is the gate; this CLI exists for `--update`.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');
export const baselinePath = path.join(appDir, '.quality-baseline.json');

function walk(dir, match, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, match, acc);
    else if (match.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Test files that vi.mock one of the app's own stores, hooks, services, or components. */
export function internalMockFiles(files = walk(path.join(appDir, 'src'), /\.test\.tsx?$/)) {
  const internal = /vi\.mock\(\s*['"]\.{1,2}\/(?:[^'"]*\/)?(stores|hooks|services|components)\//;
  return files.filter((f) => internal.test(readFileSync(f, 'utf8')));
}

/**
 * Assertions that only prove an element exists. `.not.toBeInTheDocument()`
 * asserts absence, which is an outcome, so it does not count.
 */
export function existenceAssertions(files = walk(path.join(appDir, 'src'), /\.test\.tsx?$/)) {
  const existence = /(?<!\.not)\.toBeInTheDocument\(\)|\.toBeDefined\(\)/g;
  return files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(existence)?.length ?? 0), 0);
}

/** Terms the glossary lists under _Avoid_, with the canonical term they stand in for. */
export function avoidedTerms(glossary = readFileSync(path.join(repoRoot, 'agents/project/glossary.md'), 'utf8')) {
  const terms = [];
  let canonical = null;
  for (const line of glossary.split('\n')) {
    const heading = /^\*\*(.+?)\*\*:?\s*$/.exec(line.trim());
    if (heading) canonical = heading[1];
    const avoid = /^_Avoid_:\s*(.+)$/.exec(line.trim());
    if (avoid && canonical) {
      for (const term of avoid[1].split(',').map((t) => t.trim()).filter(Boolean)) {
        terms.push({ term, canonical });
      }
    }
  }
  return terms;
}

/** Occurrences of avoided terms in agent and developer prose (not code, not user copy). */
export function avoidedTermHits(terms = avoidedTerms()) {
  const files = [
    ...walk(path.join(repoRoot, 'agents'), /\.md$/),
    ...walk(path.join(repoRoot, 'docs/developer-guide'), /\.rst$/),
    path.join(repoRoot, 'AGENTS.project.md'),
  ].filter((f) => !f.endsWith('glossary.md'));
  let hits = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const { term } of terms) {
      const re = new RegExp(`(?<![\\w-])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'gi');
      hits += text.match(re)?.length ?? 0;
    }
  }
  return hits;
}

export function currentCounts() {
  return {
    internalMockFiles: internalMockFiles().length,
    existenceAssertions: existenceAssertions(),
    avoidedTermHits: avoidedTermHits(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = currentCounts();
  if (process.argv.includes('--update')) {
    writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
    console.log('Baseline written:', counts);
  } else {
    console.log(counts);
  }
}
