/**
 * Gate for C6, the testing playbook's seam rule, and the glossary's avoided
 * terms. Counting lives in `scripts/quality-ratchet.mjs` so `--update` and
 * this test cannot disagree about what a hit is. Each number may fall or
 * hold; a rise fails here with the file or term that caused it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  avoidedTerms,
  baselinePath,
  currentCounts,
  internalMockFiles,
} from '../../scripts/quality-ratchet.mjs';

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Record<string, number>;

describe('quality ratchet (.quality-baseline.json)', () => {
  const counts = currentCounts();

  it('test files mocking the app\'s own stores, hooks, services, or components do not multiply', () => {
    expect(
      counts.internalMockFiles,
      `${counts.internalMockFiles} files > baseline ${baseline.internalMockFiles}; test through the real module and mock api/* instead:\n${internalMockFiles().join('\n')}`,
    ).toBeLessThanOrEqual(baseline.internalMockFiles);
  });

  it('existence-only assertions (C6) do not multiply', () => {
    expect(
      counts.existenceAssertions,
      `${counts.existenceAssertions} > baseline ${baseline.existenceAssertions}; assert a value or outcome, not that an element exists`,
    ).toBeLessThanOrEqual(baseline.existenceAssertions);
  });

  it('glossary avoided terms do not spread through agent and developer prose', () => {
    expect(avoidedTerms().length).toBeGreaterThan(0);
    expect(
      counts.avoidedTermHits,
      `${counts.avoidedTermHits} > baseline ${baseline.avoidedTermHits}; use the glossary's canonical term`,
    ).toBeLessThanOrEqual(baseline.avoidedTermHits);
  });

  it('baseline has not been raised without leaving room to shrink', () => {
    // A baseline far above the count is a raised number nobody lowered back.
    for (const [key, allowed] of Object.entries(baseline)) {
      const count = counts[key as keyof typeof counts];
      expect(allowed - count, `${key}: baseline ${allowed} is ${allowed - count} above the count; run scripts/quality-ratchet.mjs --update`).toBeLessThanOrEqual(5);
    }
  });
});
