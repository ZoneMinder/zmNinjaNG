/**
 * extractTimeframes (refs #270): one constrained model call lists the time
 * expressions in a question, each is resolved through interpretWhen (warming
 * its per-day cache), and the turn learns whether the period is knowable.
 * These tests cover the plumbing (schema, parse, default, abstain, cache
 * warm); interpretation quality is the interpreter's own concern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTimeframes, scanTimeExpressions, TIMEFRAME_SCHEMA, buildTimeframeSystemLine } from '../timeframe-stage';
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

  it('keeps scan-found phrases even when the model returns an empty list', async () => {
    // The decoder drops list members and compact forms nondeterministically; the
    // scanner owns them, so a compact clock range plus both day words survive even
    // when the model surfaces nothing. The clock range has no day to anchor it and
    // does not resolve, yet stays in the allowed list for the model to compose.
    const p = makeProvider(
      () => '{"phrases":[],"none":true}',
      (phrase) => {
        if (phrase === 'today') return '{"daysAgo":0}';
        if (phrase === 'yesterday') return '{"daysAgo":1}';
        return 'no window here';
      },
    );
    const result = await extractTimeframes('Compare 10am-6pm yesterday and today.', p, NOW, TZ, signal());
    expect(result.abstained).toBe(false);
    expect(result.phrases).toEqual(['10am-6pm', 'yesterday', 'today']);
    expect(result.resolved).toEqual([
      { phrase: 'yesterday', fields: { daysAgo: 1 } },
      { phrase: 'today', fields: { daysAgo: 0 } },
    ]);
  });

  it('keeps scan-found phrases when the model reply is unparseable junk', async () => {
    const p = makeProvider(
      () => 'total garbage, no json at all',
      () => '{"fromDate":"2026-06-01","toDate":"2026-06-30"}',
    );
    const result = await extractTimeframes('give me a recap of last month', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['last month']);
    expect(result.abstained).toBe(false);
  });

  it('proceeds on scan phrases when the extraction model call fails', async () => {
    const complete = vi.fn(async (system: string) => {
      if (system.includes('find the time expressions')) throw new Error('offline');
      return { text: '{"daysAgo":1}' };
    });
    const p = { complete } as unknown as AssistantProvider;
    const result = await extractTimeframes('what happened yesterday', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['yesterday']);
    expect(result.resolved).toEqual([{ phrase: 'yesterday', fields: { daysAgo: 1 } }]);
    expect(result.abstained).toBe(false);
  });

  it('unions scan phrases with model phrases the scan could not see', async () => {
    const p = makeProvider(
      () => '{"phrases":["letzte woche"],"none":false}',
      (phrase) => (phrase === 'today' ? '{"daysAgo":0}' : '{"lastCount":1,"lastUnit":"week"}'),
    );
    const result = await extractTimeframes('was los today letzte woche', p, NOW, TZ, signal());
    expect(result.phrases).toEqual(['today', 'letzte woche']);
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

/**
 * Refs #434, observed live: "How may folks came..." matched the bare
 * month-name class as the month of May, and the obedient planner then issued
 * a wasted whole-of-May query. The four month/season names that double as
 * everyday words match only behind a determiner; the unambiguous names stay
 * bare, and "<month> <day>" keeps the full list.
 */
describe('scanTimeExpressions month-word guard', () => {
  it('ignores may/march/fall/spring used as ordinary words', () => {
    expect(scanTimeExpressions('How may folks came to the front of my house?')).toEqual([]);
    expect(scanTimeExpressions('did the camera fall over')).toEqual([]);
    expect(scanTimeExpressions('march the recording out')).toEqual([]);
  });

  it('still finds them behind a determiner, verbatim', () => {
    expect(scanTimeExpressions('how busy was it in may')).toEqual(['in may']);
    expect(scanTimeExpressions('summarize this march')).toEqual(['this march']);
    expect(scanTimeExpressions('what happened last fall')).toEqual(['last fall']);
  });

  it('keeps unambiguous months bare and month+day with the full list', () => {
    expect(scanTimeExpressions('how busy was april')).toEqual(['april']);
    expect(scanTimeExpressions('what happened on may 15')).toEqual(['may 15']);
  });
});

/** Refs #434: "between mon and tue" had no scan class and no interpreter
 *  branch, so the model computed the dates itself and started on Sunday. */
describe('scanTimeExpressions weekday ranges', () => {
  it('finds a between-weekdays span, abbreviations included', () => {
    expect(scanTimeExpressions('who came by between mon and tue?')).toEqual(['between mon and tue']);
    expect(scanTimeExpressions('what happened from friday to sunday')).toEqual(['from friday to sunday']);
  });

  it('does not fire a bare abbreviation outside the range shape', () => {
    expect(scanTimeExpressions('the cat sat on the mat')).toEqual([]);
  });
});

describe('scanTimeExpressions lunch band', () => {
  // Two adjacent phrases, not one: the compound "at lunch 5 days ago" is the
  // extraction model's to copy whole, and containment dedup then absorbs
  // these halves into it (refs #434).
  it('finds lunch as a part of the day', () => {
    expect(scanTimeExpressions('who came at lunch 5 days ago')).toEqual(['lunch', '5 days ago']);
    expect(scanTimeExpressions('anything around lunchtime')).toEqual(['lunchtime']);
  });
});

/**
 * Refs #434: with a roster, the parse call already copied the time phrases,
 * so extractTimeframes takes them as `statedPhrases` and makes NO extraction
 * model call of its own; the interpreter calls (and the scan, provenance,
 * and abstain logic) are unchanged. `undefined` statedPhrases keeps the old
 * extraction call: roster-less installs and group mode still extract.
 */
describe('extractTimeframes with parse-stated phrases', () => {
  beforeEach(() => resetWindowInterpreterCacheForTests());

  it('skips the extraction model call and unions stated phrases with the scan', async () => {
    const p = makeProvider(
      () => {
        throw new Error('extraction must not be called');
      },
      () => '{"daysAgo":1}',
    );
    const result = await extractTimeframes('was war letzte Woche los, and yesterday', p, NOW, TZ, signal(), [
      'letzte Woche',
    ]);
    // Scan found "yesterday"; the stated phrase adds what regex cannot see.
    expect(result.phrases).toEqual(['yesterday', 'letzte Woche']);
    expect(result.abstained).toBe(false);
    // Only interpreter calls happened.
    for (const [system] of vi.mocked(p.complete).mock.calls) {
      expect(system).not.toContain('find the time expressions');
    }
  });

  it('drops a stated phrase that is not a substring of the question', async () => {
    const p = makeProvider(() => '', () => '{"daysAgo":0}');
    const result = await extractTimeframes('what happened today', p, NOW, TZ, signal(), ['2026-07-16', 'today']);
    expect(result.phrases).toEqual(['today']);
  });

  // Containment dedup (refs #434): the scan emits the halves ("lunch",
  // "5 days ago"), the parse copies the compound; only the compound survives,
  // so the planner never queries the whole day next to the lunch band.
  it('absorbs scan phrases contained in a stated compound', async () => {
    const p = makeProvider(() => '', () => '{"daysAgo":5,"fromTime":"11:00","toTime":"13:00"}');
    const result = await extractTimeframes('who came at lunch 5 days ago', p, NOW, TZ, signal(), [
      'at lunch 5 days ago',
    ]);
    expect(result.phrases).toEqual(['at lunch 5 days ago']);
  });

  it('still answers on the scan alone when stated phrases are empty', async () => {
    const p = makeProvider(() => '', () => '{"daysAgo":0}');
    const result = await extractTimeframes('what happened today', p, NOW, TZ, signal(), []);
    expect(result.phrases).toEqual(['today']);
  });
});

/** Refs #438: containment absorbs a contained phrase only when its container
 *  actually resolved. "all this week" once swallowed the scan-vouched "this
 *  week" and then failed to interpret, leaving the turn with nothing. */
describe('resolution-aware containment', () => {
  beforeEach(() => resetWindowInterpreterCacheForTests());

  it('keeps the contained scan phrases when the compound fails to resolve', async () => {
    const p = makeProvider(
      () => '',
      (phrase) => (phrase === 'at lunch 5 days ago' ? 'garbage' : '{"daysAgo":5}'),
    );
    const result = await extractTimeframes('who came at lunch 5 days ago', p, NOW, TZ, signal(), [
      'at lunch 5 days ago',
    ]);
    expect(result.phrases).toEqual(['lunch', '5 days ago']);
    expect(result.abstained).toBe(false);
  });
});

/** Refs #442: a container that "resolved" to NO window (none / {}) must not
 *  absorb a scan-vouched contained phrase - that is how "all this week"
 *  killed "this week" and left the turn with an unresolvable phrase. */
describe('windowless containers do not absorb', () => {
  beforeEach(() => resetWindowInterpreterCacheForTests());

  it('keeps the contained phrase when the compound resolves to no window', async () => {
    const p = makeProvider(
      () => '',
      (phrase) => (phrase === 'all this week' ? '{"none":true}' : '{"meaning":"w","week":"this"}'),
    );
    const result = await extractTimeframes('hows the front looking all this week?', p, NOW, TZ, signal(), [
      'all this week',
    ]);
    expect(result.phrases).toContain('this week');
    expect(result.abstained).toBe(false);
  });
});
