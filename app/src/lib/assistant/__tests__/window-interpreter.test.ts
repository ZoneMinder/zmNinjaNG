/**
 * interpretWhen (refs #265): a single-purpose model call maps a human time
 * phrase to WindowFields under a constrained schema. These tests cover the
 * plumbing (schema handed to the provider, defensive parsing, caching, error
 * paths); the interpretation quality itself is measured by the live eval
 * (scripts/prompt-eval.mts interpret stage), not unit tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interpretWhen, resetWindowInterpreterCacheForTests, WINDOW_SCHEMA } from '../window-interpreter';
import type { AssistantProvider } from '../types';

const NOW = new Date('2026-07-16T14:30:00Z');

function providerSaying(text: string): AssistantProvider {
  return { complete: vi.fn().mockResolvedValue({ text }) } as unknown as AssistantProvider;
}

describe('interpretWhen', () => {
  beforeEach(() => resetWindowInterpreterCacheForTests());

  it('passes the schema and the phrase to the provider and parses the fields', async () => {
    const p = providerSaying('{"daysAgo": 1}');
    const fields = await interpretWhen('yesterday', p, NOW, 'America/New_York', new AbortController().signal);
    expect(fields).toEqual({ daysAgo: 1 });
    const [system, phrase, , schema] = vi.mocked(p.complete).mock.calls[0];
    expect(system).toContain('Today is Thursday, 2026-07-16');
    expect(phrase).toBe('yesterday');
    expect(schema).toBe(WINDOW_SCHEMA);
  });

  it('recovers fields wrapped in prose from an unconstrained backend', async () => {
    const p = providerSaying('Sure: {"lastCount": 2, "lastUnit": "week"} there you go');
    const fields = await interpretWhen('past 2 weeks', p, NOW, 'UTC', new AbortController().signal);
    expect(fields).toEqual({ lastCount: 2, lastUnit: 'week' });
  });

  it('parses a calendar span', async () => {
    const p = providerSaying('{"fromDate": "2026-04-01", "toDate": "2026-04-30"}');
    expect(await interpretWhen('april', p, NOW, 'UTC', new AbortController().signal)).toEqual({
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
    });
  });

  it('maps none:true to an empty window', async () => {
    const p = providerSaying('{"none": true}');
    expect(await interpretWhen('all time', p, NOW, 'UTC', new AbortController().signal)).toEqual({});
  });

  it('returns a corrective error for an unparseable reply', async () => {
    const p = providerSaying('no json here');
    const result = await interpretWhen('whenever', p, NOW, 'UTC', new AbortController().signal);
    expect(result).toMatchObject({ error: expect.stringContaining('Could not interpret') });
  });

  it('returns a corrective error, not a throw, when the provider fails', async () => {
    const p = { complete: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AssistantProvider;
    const result = await interpretWhen('yesterday', p, NOW, 'UTC', new AbortController().signal);
    expect(result).toMatchObject({ error: expect.stringContaining('right now') });
  });

  it('caches per phrase and calendar day, so repeats cost nothing', async () => {
    const p = providerSaying('{"daysAgo": 0}');
    await interpretWhen('today', p, NOW, 'UTC', new AbortController().signal);
    await interpretWhen('  TODAY ', p, NOW, 'UTC', new AbortController().signal);
    expect(p.complete).toHaveBeenCalledTimes(1);
  });

  it('propagates an abort instead of caching it as an error', async () => {
    const p = { complete: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')) } as unknown as AssistantProvider;
    await expect(interpretWhen('today', p, NOW, 'UTC', new AbortController().signal)).rejects.toThrow('Aborted');
  });

  // A constrained decoder junk-fills optionals under a wide shape (Apple FM
  // stamped "weekend":0 on nearly every failure). The repair drops that field
  // when a real day signal is present; a genuine weekend phrase keeps it.
  it('drops a junk weekend field when a day signal is present', async () => {
    const p = providerSaying('{"daysAgo": 0, "weekend": 0}');
    expect(await interpretWhen('today', p, NOW, 'UTC', new AbortController().signal)).toEqual({ daysAgo: 0 });
  });

  it('keeps weekend when it stands alone', async () => {
    const p = providerSaying('{"weekend": 1}');
    expect(await interpretWhen('last weekend', p, NOW, 'UTC', new AbortController().signal)).toEqual({ weekend: 1 });
  });

  // The schema now emits a string enum for weekend; parseFields passes it through
  // verbatim and resolveWindow maps it to a weekends-ago number.
  it('passes a string weekend enum through unchanged', async () => {
    const p = providerSaying('{"weekend": "last"}');
    expect(await interpretWhen('last weekend', p, NOW, 'UTC', new AbortController().signal)).toEqual({ weekend: 'last' });
  });

  it('drops lastCount that arrived without lastUnit', async () => {
    const p = providerSaying('{"lastCount": 3}');
    expect(await interpretWhen('past 3 weeks', p, NOW, 'UTC', new AbortController().signal)).toEqual({});
  });

  // FM's exclusive-end habit on a BARE month name: "last month" arrives as a
  // fromDate on the 1st and a toDate on the 1st of the NEXT month, which
  // resolveWindow (inclusive toDate) would overshoot by a day. The clamp fires
  // only when the phrase names no number.
  it('clamps an exclusive month end on a digit-free phrase', async () => {
    const p = providerSaying('{"fromDate": "2026-06-01", "toDate": "2026-07-01"}');
    expect(await interpretWhen('last month', p, NOW, 'UTC', new AbortController().signal)).toEqual({
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
    });
  });

  it('leaves an explicit dated span untouched (the phrase carries digits)', async () => {
    const p = providerSaying('{"fromDate": "2026-06-01", "toDate": "2026-07-01"}');
    expect(await interpretWhen('june 1 to july 1', p, NOW, 'UTC', new AbortController().signal)).toEqual({
      fromDate: '2026-06-01',
      toDate: '2026-07-01',
    });
  });
});

describe('WINDOW_SCHEMA', () => {
  const branches = (WINDOW_SCHEMA as { anyOf: Array<{ properties: Record<string, unknown>; required: string[] }> }).anyOf;

  it('is a top-level anyOf of per-class branches, each with required fields', () => {
    expect(Array.isArray(branches)).toBe(true);
    for (const b of branches) {
      expect(Array.isArray(b.required)).toBe(true);
      expect(b.required.length).toBeGreaterThan(0);
      // Every required key must be declared as a property of its own branch.
      for (const key of b.required) expect(b.properties).toHaveProperty(key);
    }
  });

  // v2: every branch is all-required so FM cannot drop a left-optional field,
  // with ONE measured exception - the weekday branch keeps fromTime/toTime
  // optional because splitting it made qwen drop the clock band (see schema doc).
  it('leaves no optional property in any branch except the weekday clock band', () => {
    for (const b of branches) {
      const optional = Object.keys(b.properties).filter((k) => !b.required.includes(k));
      if (b.required.includes('weekday')) {
        expect(optional.sort()).toEqual(['fromTime', 'toTime']);
      } else {
        expect(optional).toEqual([]);
      }
    }
  });

  it('makes the two measured failure signatures unexpressable in a single branch', () => {
    // No branch offers both lastCount and lastUnit as anything but a required
    // pair, and no branch pairs weekend with a day field.
    const rolling = branches.find((b) => b.required.includes('lastCount'));
    expect(rolling?.required).toEqual(expect.arrayContaining(['lastCount', 'lastUnit']));
    const weekendBranch = branches.find((b) => b.required.includes('weekend'));
    expect(Object.keys(weekendBranch?.properties ?? {})).toEqual(['weekend']);
  });

  it('constrains weekend to a string enum the model is exact on', () => {
    const weekendBranch = branches.find((b) => b.required.includes('weekend')) as
      | { properties: { weekend: { type: string; enum: string[] } } }
      | undefined;
    expect(weekendBranch?.properties.weekend.type).toBe('string');
    expect(weekendBranch?.properties.weekend.enum).toEqual(['this', 'last', 'two-ago']);
  });
});
