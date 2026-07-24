/**
 * interpretWhen (refs #265): a single-purpose model call maps a human time
 * phrase to WindowFields under a constrained schema. These tests cover the
 * plumbing (schema handed to the provider, defensive parsing, caching, error
 * paths); the interpretation quality itself is measured by the live eval
 * (scripts/prompt-eval.mts interpret stage), not unit tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interpretWhen, resetWindowInterpreterCacheForTests, selectBranches, WINDOW_SCHEMA } from '../window-interpreter';
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

describe('selectBranches', () => {
  const branchesOf = (schema: Record<string, unknown>): Array<{ required: string[] }> =>
    (schema.anyOf as Array<{ required: string[] }> | undefined) ?? [schema as unknown as { required: string[] }];
  const requiredSets = (schema: Record<string, unknown>): string[][] =>
    branchesOf(schema).map((b) => [...b.required].sort());

  it('offers only clock-capable branches for a wall-clock phrase', () => {
    const sets = requiredSets(selectBranches('yesterday from 4pm to 10pm'));
    for (const req of sets) {
      // Every offered branch can carry a band: it either requires the times or
      // is the weekday branch whose band is optional.
      expect(req.includes('fromTime') || req.includes('weekday')).toBe(true);
    }
    expect(sets.some((req) => req.includes('lastCount'))).toBe(false);
  });

  it('routes part-of-day words, accent-insensitively, to the clock family', () => {
    for (const phrase of ['this morning', 'ce matin', 'hier soir', 'ayer por la mañana']) {
      const sets = requiredSets(selectBranches(phrase));
      expect(sets.every((req) => req.includes('fromTime') || req.includes('weekday'))).toBe(true);
    }
  });

  it('keeps the rolling family when a rolling count rides a clock word', () => {
    const sets = requiredSets(selectBranches('last 2 nights'));
    expect(sets.some((req) => req.includes('lastCount'))).toBe(true);
  });

  // The weekday branch is the one clock branch whose band stays optional, so a
  // decoder drifts to it and mislabels a non-weekday clock phrase as a weekday.
  // Offer it only when the phrase names a weekday (en or another language).
  it('keeps the weekday branch when a clock phrase names a weekday', () => {
    for (const phrase of ['last tuesday night', 'mardi soir', 'friday from 4pm to 6pm']) {
      const sets = requiredSets(selectBranches(phrase));
      expect(sets.some((req) => req.includes('weekday'))).toBe(true);
    }
  });

  it('drops the weekday branch from a clock phrase with no weekday word', () => {
    for (const phrase of ['yesterday evening', 'today between 9am and 5pm', 'this morning', 'ce matin']) {
      const sets = requiredSets(selectBranches(phrase));
      expect(sets.some((req) => req.includes('weekday'))).toBe(false);
      // Every offered branch still carries a clock band (or the rolling pair).
      expect(sets.every((req) => req.includes('fromTime') || req.includes('lastCount'))).toBe(true);
    }
  });

  it('offers only the both-ends span for a bare month or season', () => {
    for (const phrase of ['april', 'in april', 'this summer']) {
      const sets = requiredSets(selectBranches(phrase));
      expect(sets).toEqual([['fromDate', 'toDate']]);
    }
  });

  it('falls open to the full schema for unmarked phrases', () => {
    // 'on sunday' names a weekday but carries no clock marker, so it takes the
    // non-clock path and is offered the full schema, weekday branch included.
    for (const phrase of ['yesterday', 'letzte Woche', 'all time', 'the 21st', 'on sunday']) {
      expect(selectBranches(phrase)).toBe(WINDOW_SCHEMA);
    }
  });

  it('interpretWhen sends the phrase-selected schema to the provider', async () => {
    resetWindowInterpreterCacheForTests();
    const complete = vi.fn().mockResolvedValue({ text: '{"daysAgo":1,"fromTime":"18:00","toTime":"23:59"}' });
    const provider = { complete, chat: vi.fn() } as unknown as AssistantProvider;
    await interpretWhen('yesterday evening', provider, new Date('2026-07-19T18:00:00Z'), 'America/New_York', new AbortController().signal);
    const sent = complete.mock.calls[0][3] as Record<string, unknown>;
    expect(sent).not.toBe(WINDOW_SCHEMA);
    const sets = requiredSets(sent);
    expect(sets.every((req) => req.includes('fromTime') || req.includes('weekday'))).toBe(true);
  });
});
