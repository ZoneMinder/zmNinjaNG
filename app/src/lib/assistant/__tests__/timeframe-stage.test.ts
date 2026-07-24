/**
 * extractTimeframes (refs #270): one constrained model call lists the time
 * expressions in a question, each is resolved through interpretWhen (warming
 * its per-day cache), and the turn learns whether the period is knowable.
 * These tests cover the plumbing (schema, parse, default, abstain, cache
 * warm); interpretation quality is the interpreter's own concern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTimeframes, TIMEFRAME_SCHEMA, buildTimeframeSystemLine } from '../timeframe-stage';
import { interpretWhen, resetWindowInterpreterCacheForTests } from '../window-interpreter';
import type { AssistantProvider } from '../types';

const NOW = new Date('2026-07-16T14:30:00Z');
const TZ = 'America/New_York';
const signal = () => new AbortController().signal;

/** A provider whose `complete` routes by the system prompt: the extractor's
 *  prompt says "find the time expressions", the interpreter's says "convert a
 *  human time phrase". Each side returns whatever the test wired for it. */
function makeProvider(
  onExtract: (question: string) => string,
  onInterpret: (phrase: string) => string,
): AssistantProvider {
  const complete = vi.fn(async (system: string, text: string) => ({
    text: system.includes('find the time expressions') ? onExtract(text) : onInterpret(text),
  }));
  return { complete } as unknown as AssistantProvider;
}

describe('extractTimeframes', () => {
  beforeEach(() => resetWindowInterpreterCacheForTests());

  it('passes the schema and the question, returns every resolved phrase', async () => {
    const p = makeProvider(
      () => '{"phrases":["today","yesterday"],"none":false}',
      (phrase) => (phrase === 'today' ? '{"daysAgo":0}' : '{"daysAgo":1}'),
    );
    const result = await extractTimeframes('today vs yesterday', p, NOW, TZ, signal());
    expect(result).toEqual({ phrases: ['today', 'yesterday'], abstained: false });

    const [system, text, , schema] = vi.mocked(p.complete).mock.calls[0];
    expect(system).toContain('Today is Thursday, 2026-07-16');
    expect(text).toBe('today vs yesterday');
    expect(schema).toBe(TIMEFRAME_SCHEMA);
  });

  it('defaults to today when the question names no time', async () => {
    const p = makeProvider(
      () => '{"phrases":[],"none":true}',
      () => '{"daysAgo":0}',
    );
    expect(await extractTimeframes('give me a summary', p, NOW, TZ, signal())).toEqual({
      phrases: ['today'],
      abstained: false,
    });
  });

  it('recovers phrases wrapped in prose from an unconstrained backend', async () => {
    const p = makeProvider(
      () => 'Sure: {"phrases":["last week"],"none":false} done',
      () => '{"lastCount":1,"lastUnit":"week"}',
    );
    expect((await extractTimeframes('what about last week', p, NOW, TZ, signal())).phrases).toEqual(['last week']);
  });

  it('abstains when the question named a time but no interpretation resolves', async () => {
    const p = makeProvider(
      () => '{"phrases":["blursday"],"none":false}',
      () => 'no json here',
    );
    expect(await extractTimeframes('what happened blursday', p, NOW, TZ, signal())).toEqual({
      phrases: [],
      abstained: true,
    });
  });

  it('drops only the phrases that fail, keeping the rest', async () => {
    const p = makeProvider(
      () => '{"phrases":["today","blursday"],"none":false}',
      (phrase) => (phrase === 'today' ? '{"daysAgo":0}' : 'garbage'),
    );
    expect(await extractTimeframes('today and blursday', p, NOW, TZ, signal())).toEqual({
      phrases: ['today'],
      abstained: false,
    });
  });

  it('de-dupes phrases that differ only by case', async () => {
    const p = makeProvider(
      () => '{"phrases":["today","Today"],"none":false}',
      () => '{"daysAgo":0}',
    );
    const result = await extractTimeframes('today Today', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['today']);
  });

  it('pre-warms interpretWhen so a later resolve of the same phrase is free', async () => {
    const p = makeProvider(
      () => '{"phrases":["today"],"none":false}',
      () => '{"daysAgo":0}',
    );
    await extractTimeframes('anything today', p, NOW, TZ, signal());
    const callsAfterStage = vi.mocked(p.complete).mock.calls.length; // 1 extract + 1 interpret

    const fields = await interpretWhen('today', p, NOW, TZ, signal());
    expect(fields).toEqual({ daysAgo: 0 });
    // No new model call: the stage already cached "today" for this day.
    expect(vi.mocked(p.complete).mock.calls.length).toBe(callsAfterStage);
  });

  it('falls open to today when extraction itself fails', async () => {
    const complete = vi.fn(async (system: string) => {
      if (system.includes('find the time expressions')) throw new Error('offline');
      return { text: '{"daysAgo":0}' };
    });
    const p = { complete } as unknown as AssistantProvider;
    expect(await extractTimeframes('summary', p, NOW, TZ, signal())).toEqual({ phrases: ['today'], abstained: false });
  });

  it('propagates an abort instead of swallowing it', async () => {
    const complete = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const p = { complete } as unknown as AssistantProvider;
    await expect(extractTimeframes('today', p, NOW, TZ, signal())).rejects.toThrow('Aborted');
  });
});

describe('buildTimeframeSystemLine', () => {
  it('quotes each resolved phrase for the answering model to copy', () => {
    expect(buildTimeframeSystemLine(['today', 'January 21'])).toBe(
      'Timeframes for this question, already resolved (copy these exact phrases into when): "today", "January 21".',
    );
  });
});
