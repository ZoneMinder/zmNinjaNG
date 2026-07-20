import { describe, it, expect } from 'vitest';
import { buildResultSummary, countObjects } from '../result-summary';

const WINDOW = { from: '2026-07-20 00:00:00', to: '2026-07-20 09:17:18' };

describe('countObjects', () => {
  it('tallies labels across rows', () => {
    expect(
      countObjects([{ objects: ['person'] }, { objects: ['person'] }, { objects: ['car'] }]),
    ).toEqual({ person: 2, car: 1 });
  });

  it('counts a row detecting two things once for each', () => {
    expect(countObjects([{ objects: ['person', 'car'] }])).toEqual({ person: 1, car: 1 });
  });

  it('ignores rows with no objects field', () => {
    expect(countObjects([{ monitor: 'A' }, { objects: ['car'] }])).toEqual({ car: 1 });
  });
});

describe('buildResultSummary', () => {
  it('writes the sentence the model kept failing to derive', () => {
    // The live case: five rows, and the model enumerated them one by one while
    // quoting neither matchCount nor countsByMonitor.
    const summary = buildResultSummary({
      window: WINDOW,
      matchCount: 5,
      countsByMonitor: { FrontDoor: 2, 'Front Yard': 2, 'Garage Outdoor': 1 },
      objectCounts: { person: 4, car: 1 },
      partial: false,
    });
    expect(summary).toBe(
      '5 events between 2026-07-20 00:00:00 and 2026-07-20 09:17:18. ' +
        'By monitor: FrontDoor 2, Front Yard 2, Garage Outdoor 1. Detected: person 4, car 1.',
    );
  });

  it('orders counts busiest first', () => {
    const summary = buildResultSummary({
      window: WINDOW,
      matchCount: 3,
      countsByMonitor: { Quiet: 1, Busy: 2 },
      objectCounts: {},
      partial: false,
    });
    expect(summary).toContain('By monitor: Busy 2, Quiet 1.');
  });

  it('says a partial result is partial', () => {
    const summary = buildResultSummary({
      window: WINDOW,
      matchCount: 25,
      countsByMonitor: { A: 25 },
      objectCounts: { person: 25 },
      partial: true,
    });
    expect(summary).toContain('partial result');
  });

  it('reports an empty result without inventing a period', () => {
    expect(
      buildResultSummary({
        window: WINDOW,
        matchCount: 0,
        countsByMonitor: {},
        objectCounts: {},
        partial: false,
      }),
    ).toBe('No events between 2026-07-20 00:00:00 and 2026-07-20 09:17:18.');
  });

  it('names the absence of a time filter rather than implying one', () => {
    // Told only a count, the model named a period it had never queried.
    const summary = buildResultSummary({
      window: 'all recorded events, no time filter applied',
      matchCount: 2,
      countsByMonitor: { A: 2 },
      objectCounts: {},
      partial: false,
    });
    expect(summary).toBe(
      '2 events across all recorded events, no time filter applied. By monitor: A 2.',
    );
  });

  it('uses the singular for one event', () => {
    const summary = buildResultSummary({
      window: WINDOW,
      matchCount: 1,
      countsByMonitor: { A: 1 },
      objectCounts: { car: 1 },
      partial: false,
    });
    expect(summary).toMatch(/^1 event between/);
  });
});
