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
    expect(result).toEqual({
      phrases: ['today', 'yesterday'],
      resolved: [
        { phrase: 'today', fields: { daysAgo: 0 } },
        { phrase: 'yesterday', fields: { daysAgo: 1 } },
      ],
      abstained: false,
    });

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
      resolved: [{ phrase: 'today', fields: { daysAgo: 0 } }],
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
      resolved: [],
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
      resolved: [{ phrase: 'today', fields: { daysAgo: 0 } }],
      abstained: false,
    });
  });

  it('drops phrases the model parroted from the prompt date line, keeping the real one', async () => {
    // The model echoes the "Today is Friday, 2026-07-24 ..." line and returns
    // those as phrases; only "yesterday" was actually in the question. The
    // parroted ones must never reach the interpreter.
    const interpret = vi.fn((phrase: string) => (phrase === 'yesterday' ? '{"daysAgo":1}' : '{"daysAgo":0}'));
    const p = makeProvider(() => '{"phrases":["today","Friday","2026-07-24","yesterday"],"none":false}', interpret);
    const result = await extractTimeframes('what happened yesterday', p, NOW, TZ, signal());
    expect(result).toEqual({ phrases: ['yesterday'], resolved: [{ phrase: 'yesterday', fields: { daysAgo: 1 } }], abstained: false });
    // Only the surviving phrase was interpreted; the three parroted ones were
    // filtered in code before the loop.
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(interpret).toHaveBeenCalledWith('yesterday');
  });

  it('defaults to today when every phrase was parroted, never abstaining', async () => {
    // None of these appear in the question, so the filter empties the list;
    // that is the same as naming no time, which defaults to today (not abstain).
    const p = makeProvider(
      () => '{"phrases":["today","Friday","2026-07-24","America/New_York"],"none":false}',
      () => '{"daysAgo":0}',
    );
    expect(await extractTimeframes('any events at my place', p, NOW, TZ, signal())).toEqual({
      phrases: ['today'],
      resolved: [{ phrase: 'today', fields: { daysAgo: 0 } }],
      abstained: false,
    });
  });

  it('returns each resolved phrase with the structured window it resolved to', async () => {
    const p = makeProvider(
      () => '{"phrases":["last hour"],"none":false}',
      () => '{"lastCount":1,"lastUnit":"hour"}',
    );
    const { resolved } = await extractTimeframes('anything in the last hour', p, NOW, TZ, signal());
    expect(resolved).toEqual([{ phrase: 'last hour', fields: { lastCount: 1, lastUnit: 'hour' } }]);
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
    expect(await extractTimeframes('summary', p, NOW, TZ, signal())).toEqual({
      phrases: ['today'],
      resolved: [],
      abstained: false,
    });
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
