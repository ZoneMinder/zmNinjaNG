/**
 * extractTimeframes (refs #270): one constrained model call lists the time
 * expressions in a question, each is resolved through interpretWhen (warming
 * its per-day cache), and the turn learns whether the period is knowable.
 * These tests cover the plumbing (schema, parse, default, abstain, cache
 * warm); interpretation quality is the interpreter's own concern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTimeframesFromQuestion, scanTimeExpressions, buildTimeframeSystemLine } from '../timeframe-stage';
import { interpretWhen, resetWindowInterpreterCacheForTests } from '../window-interpreter';
import type { AssistantProvider } from '../types';

const NOW = new Date('2026-07-16T14:30:00Z');
const TZ = 'America/New_York';
const signal = () => new AbortController().signal;


describe('scanTimeExpressions', () => {
  it('finds simple day words', () => {
    expect(scanTimeExpressions('what happened today')).toEqual(['today']);
    expect(scanTimeExpressions('compare today and yesterday')).toEqual(['today', 'yesterday']);
    expect(scanTimeExpressions('anything tonight')).toEqual(['tonight']);
  });

  it('finds modifier + part-of-day and bare part-of-day', () => {
    expect(scanTimeExpressions('how many people came this morning and this evening')).toEqual([
      'this morning',
      'this evening',
    ]);
    // The bare "yesterday" is absorbed into the longer "yesterday afternoon".
    expect(scanTimeExpressions('were there cars yesterday afternoon')).toEqual(['yesterday afternoon']);
    expect(scanTimeExpressions('anything in the evening')).toEqual(['evening']);
  });

  // The whole "<n> <unit> ago" family was invisible to the scan, so a question
  // naming one fell through to the today default and the prompt told the model
  // to answer about today (refs #310).
  it('finds "<n> <unit> ago", in digits and spelled out', () => {
    expect(scanTimeExpressions('what was the busiest hour 2 days ago?')).toEqual(['2 days ago']);
    expect(scanTimeExpressions('anything two days ago')).toEqual(['two days ago']);
    expect(scanTimeExpressions('what happened 3 hours ago')).toEqual(['3 hours ago']);
    expect(scanTimeExpressions('cars 1 week ago')).toEqual(['1 week ago']);
    expect(scanTimeExpressions('anything an hour ago')).toEqual(['an hour ago']);
  });

  it('finds weekday references including "last <weekday>"', () => {
    expect(scanTimeExpressions('what happened on sunday')).toEqual(['on sunday']);
    expect(scanTimeExpressions('anything last tuesday')).toEqual(['last tuesday']);
  });

  it('finds month/season names and compound relative periods', () => {
    expect(scanTimeExpressions('how busy was it in april')).toEqual(['april']);
    expect(scanTimeExpressions('give me a recap of last month')).toEqual(['last month']);
    expect(scanTimeExpressions('what about this week')).toEqual(['this week']);
    expect(scanTimeExpressions('anything last weekend')).toEqual(['last weekend']);
    expect(scanTimeExpressions('how did this year go')).toEqual(['this year']);
  });

  it('finds rolling spans', () => {
    expect(scanTimeExpressions('summarize the past 2 weeks')).toEqual(['past 2 weeks']);
    expect(scanTimeExpressions('anything in the last 6 hours')).toEqual(['last 6 hours']);
  });

  it('finds written and compact clock ranges', () => {
    expect(scanTimeExpressions('who came by yesterday from 4pm to 10pm')).toEqual(['yesterday', 'from 4pm to 10pm']);
    expect(scanTimeExpressions('anything today between 9am and 5pm')).toEqual(['today', 'between 9am and 5pm']);
    expect(scanTimeExpressions('Compare 10am-6pm yesterday and today.')).toEqual(['10am-6pm', 'yesterday', 'today']);
    expect(scanTimeExpressions('anything between 9-5 today')).toEqual(['9-5', 'today']);
  });

  it('finds explicit dates and bare ordinals, keeping every list member', () => {
    expect(scanTimeExpressions('show me events from july 15 and july 21')).toEqual(['july 15', 'july 21']);
    expect(scanTimeExpressions('anything between june 1 and june 15')).toEqual(['june 1', 'june 15']);
    expect(scanTimeExpressions('what happened on the 21st')).toEqual(['the 21st']);
  });

  it('de-dupes on the normalized form, keeping the first occurrence', () => {
    expect(scanTimeExpressions('today Today')).toEqual(['today']);
  });

  it('returns [] for a question that names no time', () => {
    expect(scanTimeExpressions('what cameras do I have')).toEqual([]);
    expect(scanTimeExpressions('is the server ok')).toEqual([]);
    expect(scanTimeExpressions('list all my monitors')).toEqual([]);
  });
});

describe('buildTimeframeSystemLine', () => {
  it('quotes every resolved label for the answering model to copy', () => {
    const line = buildTimeframeSystemLine(['today', 'the same day one week back']);
    expect(line).toContain('"today"');
    expect(line).toContain('"the same day one week back"');
  });
});

describe('resolveTimeframesFromQuestion', () => {
  beforeEach(() => resetWindowInterpreterCacheForTests());

  /** Provider whose complete routes by prompt: the windows interrogation
   *  says "every time period one QUESTION means"; anything else is the
   *  per-phrase interpreter (the fallback). */
  const providerWith = (onWindows: (q: string) => string, onInterpret: (p: string) => string = () => '{"daysAgo":0}') =>
    ({
      complete: vi.fn(async (system: string, text: string) => ({
        text: system.includes('every time period one QUESTION means') ? onWindows(text) : onInterpret(text),
      })),
    }) as unknown as AssistantProvider;

  it('resolves each window through the production parser and seeds the cache', async () => {
    const p = providerWith(() =>
      '{"windows":[{"meaning":"today","daysAgo":0},{"meaning":"the same day one week back","daysAgo":7}]}',
    );
    const result = await resolveTimeframesFromQuestion('compare to same day, last week', p, NOW, TZ, signal(), {
      question: 'hows today?',
      periods: ['today'],
    });
    expect(result).toEqual({
      phrases: ['today', 'the same day one week back'],
      resolved: [
        { phrase: 'today', fields: { daysAgo: 0 } },
        { phrase: 'the same day one week back', fields: { daysAgo: 7 } },
      ],
      abstained: false,
    });
    // ONE model call: the windows interrogation. The cache was seeded, so a
    // tool-time interpretWhen on the meaning label costs no model call.
    expect(vi.mocked(p.complete)).toHaveBeenCalledTimes(1);
    expect(await interpretWhen('the same day one week back', p, NOW, TZ, signal())).toEqual({ daysAgo: 7 });
    expect(vi.mocked(p.complete)).toHaveBeenCalledTimes(1);
    // The context rode the question.
    const [, text] = vi.mocked(p.complete).mock.calls[0] as unknown as [string, string];
    expect(text).toContain('hows today?');
  });

  it('skips junk windows and windowless items, keeping the good ones', async () => {
    const p = providerWith(() =>
      '{"windows":[{"meaning":"nothing","none":true},{"meaning":"bad"},{"meaning":"yesterday","daysAgo":1}]}',
    );
    const result = await resolveTimeframesFromQuestion('yesterday and whenever', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['yesterday']);
    expect(result.abstained).toBe(false);
  });

  it('falls back to the scan floor when the call fails', async () => {
    const p = {
      complete: vi.fn(async (system: string, text: string) => {
        if (system.includes('every time period one QUESTION means')) throw new Error('offline');
        return { text: text === 'today' ? '{"daysAgo":0}' : '{"daysAgo":1}' };
      }),
    } as unknown as AssistantProvider;
    const result = await resolveTimeframesFromQuestion('compare today and yesterday', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['today', 'yesterday']);
    expect(result.abstained).toBe(false);
  });

  it('defaults to today when nothing names a time anywhere', async () => {
    const p = providerWith(() => '{"windows":[]}');
    const result = await resolveTimeframesFromQuestion('what cameras do I have', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['today']);
    expect(result.abstained).toBe(false);
  });

  /** Refs #446: one window per compared PLACE produces identical periods
   *  under different labels; the range dedupe keeps one, so the planned
   *  fan-out never doubles. */
  it('collapses windows that resolve to the same range', async () => {
    const p = providerWith(() =>
      '{"windows":[{"meaning":"the front last week","week":"last"},{"meaning":"the back last week","week":"last"}]}',
    );
    const result = await resolveTimeframesFromQuestion('front vs back last week', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['the front last week']);
  });

  it('abstains only when windows were emitted, none resolved, and the scan sees no time', async () => {
    const p = providerWith(() => '{"windows":[{"meaning":"whenever","none":true}]}');
    const result = await resolveTimeframesFromQuestion('what happened at blursday oclock', p, NOW, TZ, signal());
    expect(result).toEqual({ phrases: [], resolved: [], abstained: true });
  });
});
