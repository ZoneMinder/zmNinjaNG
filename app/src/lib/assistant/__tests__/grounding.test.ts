import { describe, it, expect } from 'vitest';
import { deniesTheData, echoesToolOutput, retryIsUnusable, fallbackAnswerFromData } from '../grounding';

describe('deniesTheData', () => {
  const data = ['{"window":{},"matchCount":5,"events":[{"id":"1"}]}'];

  it('catches the retry that denied five events', () => {
    // Verbatim from a live transcript: a false rejection sent the model back to
    // rewrite and it returned this over a result carrying five events.
    expect(
      deniesTheData("None of today's events were found to be related to people or vehicles.", data),
    ).toBe(true);
  });

  it('catches the common phrasings of a nothing-found claim', () => {
    expect(deniesTheData('No events were recorded today.', data)).toBe(true);
    expect(deniesTheData('Nothing was found for today.', data)).toBe(true);
  });

  it('passes an answer that describes the rows', () => {
    expect(deniesTheData('There were 5 events: 4 people and 1 car.', data)).toBe(false);
  });

  it('passes a nothing-found claim when the data really is empty', () => {
    // The honest empty answer must survive: this fires on contradiction only.
    expect(deniesTheData('No events were recorded today.', ['{"matchCount":0,"events":[]}'])).toBe(
      false,
    );
  });

  it('stays quiet when no result carries a count it can check', () => {
    expect(deniesTheData('Nothing was found.', ['some plain text result'])).toBe(false);
  });

  // A scoped negative is a description of the data, not a denial of it, and
  // "correcting" it replaced a right answer with a rewrite.
  it('passes a partial negative that also reports a positive count', () => {
    expect(deniesTheData('No animals were detected, but 5 people came by.', data)).toBe(false);
  });
});

describe('echoesToolOutput', () => {
  // Verbatim shape from a live transcript: told to rewrite after a false
  // rejection, the model returned the whole list_events payload as its answer.
  const ECHO =
    '{"summary":"5 events between 2026-07-20 00:00:00 and 2026-07-20 09:31:51.",' +
    '"window":{"from":"2026-07-20 08:20:59","to":"2026-07-20 09:31:51"},"matchCount":5,' +
    '"countsByMonitor":{"FrontDoor":2},"objectCounts":{"person":4},"events":[]}';

  it('catches the raw tool result returned as an answer', () => {
    expect(echoesToolOutput(ECHO)).toBe(true);
  });

  it('catches it even when the model altered the values', () => {
    // The echo above already has a doctored window, so a value comparison
    // against the real output would have missed it.
    expect(echoesToolOutput(ECHO)).toBe(true);
  });

  it('passes a written answer', () => {
    expect(echoesToolOutput('There were 5 events today, 4 people and 1 car.')).toBe(false);
  });

  it('passes prose that merely mentions the field names', () => {
    expect(echoesToolOutput('The summary shows 5 events and the window covers today.')).toBe(false);
  });

  it('passes a JSON object that is not a result payload', () => {
    expect(echoesToolOutput('{"answer":"There were 5 events today."}')).toBe(false);
  });
});

describe('retryIsUnusable', () => {
  const data = ['{"matchCount":5,"events":[{"id":"1"}]}'];

  it('rejects an empty rewrite', () => {
    expect(retryIsUnusable('   ', data)).toBe(true);
  });

  it('rejects a rewrite that denies the data', () => {
    expect(retryIsUnusable('No events were found today.', data)).toBe(true);
  });

  it('rejects a rewrite that echoes the tool result', () => {
    expect(retryIsUnusable('{"matchCount":5,"events":[],"summary":"x"}', data)).toBe(true);
  });

  it('accepts a genuine rewrite', () => {
    expect(retryIsUnusable('There were 5 events today: 4 people and 1 car.', data)).toBe(false);
  });
});

describe('fallbackAnswerFromData', () => {
  // The guarantee behind removing the judge: when the model will not produce a
  // grounded answer, the user still gets a true sentence, because code wrote it.
  it('returns the summary the tool computed', () => {
    expect(fallbackAnswerFromData(['{"summary":"5 events today.","matchCount":5}'])).toBe(
      '5 events today.',
    );
  });

  it('prefers the most recent result carrying one', () => {
    expect(
      fallbackAnswerFromData(['{"summary":"old"}', '{"summary":"new"}']),
    ).toBe('new');
  });

  it('returns undefined when nothing carries a summary', () => {
    expect(fallbackAnswerFromData(['not json', '{"matchCount":1}'])).toBeUndefined();
  });
});
