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
});
