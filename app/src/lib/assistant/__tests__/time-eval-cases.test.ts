/**
 * The interpretation-case predicates must accept a correct window no matter
 * which schema branch produced it: a day reached as `daysAgo`, as an explicit
 * `date`, or as the matching `weekday` all resolve to the same range, so a
 * predicate that read raw fields would false-negative a right answer sent
 * through a different branch (refs #270). These tests pin that contract against
 * the same fixed clock the runners use.
 */
import { describe, it, expect } from 'vitest';
import { resolveWindow, type WindowFields } from '../event-range';
import { TIME_INTERPRET_CASES } from '../time-eval-cases';
import { FM_EVAL_NOW, FM_EVAL_TZ } from '../fm-eval';

const caseFor = (phrase: string) => {
  const c = TIME_INTERPRET_CASES.find((x) => x.phrase === phrase);
  if (!c) throw new Error(`no interpretation case for "${phrase}"`);
  return c;
};

/** Runs a case predicate over raw fields plus their resolveWindow output, exactly
 *  as the eval runners do. */
const passes = (phrase: string, fields: WindowFields): boolean => {
  const c = caseFor(phrase);
  return c.ok(fields as Record<string, unknown>, resolveWindow(fields, FM_EVAL_NOW, FM_EVAL_TZ));
};

describe('interpretation-case predicates accept equivalent branches', () => {
  it('clock range: both the daysAgo and the date branch pass', () => {
    // The measured failure: the model returned the date branch for "yesterday",
    // which is July 18 against the fixed clock (July 19) and resolves identically.
    expect(passes('yesterday from 4pm to 10pm', { daysAgo: 1, fromTime: '16:00', toTime: '22:00' })).toBe(true);
    expect(passes('yesterday from 4pm to 10pm', { date: '2026-07-18', fromTime: '16:00', toTime: '22:00' })).toBe(true);
    // A genuinely wrong day still fails.
    expect(passes('yesterday from 4pm to 10pm', { date: '2026-07-17', fromTime: '16:00', toTime: '22:00' })).toBe(false);
  });

  it('relative day: daysAgo and the equivalent date both pass', () => {
    expect(passes('yesterday', { daysAgo: 1 })).toBe(true);
    expect(passes('yesterday', { date: '2026-07-18' })).toBe(true);
    expect(passes('yesterday', { daysAgo: 2 })).toBe(false);
  });

  it('weekday: the weekday, daysAgo, and date branches for the same day all pass', () => {
    // Sunday is the fixed clock's own day, so all three resolve to July 19.
    expect(passes('on sunday', { weekday: 'sunday' })).toBe(true);
    expect(passes('on sunday', { daysAgo: 0 })).toBe(true);
    expect(passes('on sunday', { date: '2026-07-19' })).toBe(true);
  });
});
