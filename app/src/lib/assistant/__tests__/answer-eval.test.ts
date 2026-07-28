/**
 * The answer-quality eval (refs #270).
 *
 * This stage exists to catch the faults the other two cannot see: a backend can pick
 * the right tool with the right arguments and then lie about what came back. Each
 * test below is one of those faults, written as the answer a model actually produced.
 */
import { describe, it, expect, vi } from 'vitest';
import { runAnswerEval, ANSWER_EVAL_CASE_COUNT } from '../answer-eval';
import { ANSWER_CASES, TODAY_RESULT, EMPTY_RESULT } from '../answer-eval-cases';
import type { AssistantMessage, AssistantProvider, ToolDefinition } from '../types';

vi.mock('../../logger', () => ({
  log: { assistant: vi.fn() },
  LogLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

/** A provider that answers with whatever `answer` returns for the question. */
function providerFrom(answer: (q: string, result: string) => string | (() => never)): AssistantProvider {
  return {
    complete: vi.fn(),
    chat: async (messages: AssistantMessage[], _t: ToolDefinition[], _s: string, _sig: AbortSignal) => {
      const q = messages[0]?.text ?? '';
      const result = messages[2]?.toolResults?.[0]?.output ?? '';
      const out = answer(q, result);
      if (typeof out === 'function') out();
      return { text: out as string, toolCalls: [] };
    },
  } as unknown as AssistantProvider;
}

const signal = () => new AbortController().signal;
const NOW = new Date('2026-07-19T18:00:00Z');

/** An answer that satisfies every check of whichever case is being asked. */
function goodAnswer(q: string, result: string): string {
  if (result === EMPTY_RESULT) return 'No events were found today.';
  if (q === 'how many people came today') return '4 people came today.';
  if (q === 'what was my busiest hour today')
    return 'Your busiest hour was 08:00 with 4 events.\nSHOW: events=253363,253362,253361,253360';
  return '5 events today: FrontDoor 2, Front Yard 2, Garage Outdoor 1, including 4 person detections.';
}

describe('runAnswerEval', () => {
  it('passes every case when the answers read the data correctly', async () => {
    const report = await runAnswerEval(providerFrom(goodAnswer), NOW, 'America/New_York', signal());
    expect(report.pass).toBe(ANSWER_EVAL_CASE_COUNT);
    expect(report.failures).toEqual([]);
    expect(report.failedChecks).toEqual({});
  });

  // The worst observed failure: an answer that denies data the result carries.
  it('catches an answer that denies the data', async () => {
    const report = await runAnswerEval(
      providerFrom((q, result) =>
        result === TODAY_RESULT && q === 'summarize today' ? 'No events were found today.' : goodAnswer(q, result),
      ),
      NOW,
      'America/New_York',
      signal(),
    );
    expect(report.pass).toBe(ANSWER_EVAL_CASE_COUNT - 1);
    expect(report.failedChecks['no-denial']).toBe(1);
  });

  // Observed live: the model handed back the entire list_events payload as prose.
  it('catches an answer that echoes the raw tool JSON', async () => {
    const report = await runAnswerEval(
      providerFrom((q, result) => (q === 'how many people came today' ? result : goodAnswer(q, result))),
      NOW,
      'America/New_York',
      signal(),
    );
    expect(report.failedChecks['not-json']).toBe(1);
  });

  // The fabrication this whole stage exists for: counts that are not in the data.
  it('catches invented counts', async () => {
    const report = await runAnswerEval(
      providerFrom((q, result) =>
        q === 'how many people came today' ? '15 people came today, and 10 yesterday.' : goodAnswer(q, result),
      ),
      NOW,
      'America/New_York',
      signal(),
    );
    expect(report.failedChecks['person-count']).toBe(1);
  });

  // Invented monitor names: the result names FrontDoor, Front Yard, Garage Outdoor.
  it('catches invented monitor names', async () => {
    const report = await runAnswerEval(
      providerFrom((q, result) =>
        q === 'summarize today' && result === TODAY_RESULT
          ? '5 events today: Driveway 2, Front Gate 2, Backyard 1, including 4 person detections.'
          : goodAnswer(q, result),
      ),
      NOW,
      'America/New_York',
      signal(),
    );
    expect(report.failedChecks['names-real']).toBe(1);
  });

  // The mirror image: inventing rows when the result is empty.
  it('catches rows invented over an empty result', async () => {
    const report = await runAnswerEval(
      providerFrom((q, result) =>
        result === EMPTY_RESULT ? 'There was 1 person at FrontDoor today.' : goodAnswer(q, result),
      ),
      NOW,
      'America/New_York',
      signal(),
    );
    expect(report.failedChecks['says-empty']).toBe(1);
    expect(report.failedChecks['no-invented-rows']).toBe(1);
  });

  it('counts an empty reply as a failure rather than a pass', async () => {
    const report = await runAnswerEval(providerFrom(() => '   '), NOW, 'America/New_York', signal());
    expect(report.pass).toBe(0);
    expect(report.failedChecks.empty).toBe(ANSWER_EVAL_CASE_COUNT);
  });

  it('records a backend error as a failed case and keeps going', async () => {
    let asked = 0;
    const report = await runAnswerEval(
      providerFrom((q, result) => {
        asked += 1;
        if (q === 'summarize today' && result === TODAY_RESULT) {
          return () => {
            throw new Error('Failed to deserialize a Generable type from model output');
          };
        }
        return goodAnswer(q, result);
      }),
      NOW,
      'America/New_York',
      signal(),
    );
    expect(asked).toBe(ANSWER_EVAL_CASE_COUNT);
    expect(report.failedChecks.error).toBe(1);
    expect(report.failures[0].answer).toContain('Generable');
  });

  it('stages the question, the tool call and its result, so only prose is left to write', async () => {
    let seen: AssistantMessage[] = [];
    const provider = {
      complete: vi.fn(),
      chat: async (messages: AssistantMessage[]) => {
        seen = messages;
        return { text: goodAnswer(messages[0]?.text ?? '', messages[2]?.toolResults?.[0]?.output ?? ''), toolCalls: [] };
      },
    } as unknown as AssistantProvider;
    await runAnswerEval(provider, NOW, 'America/New_York', signal());

    expect(seen.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(seen[1].toolCalls?.[0].name).toBe('list_events');
    // The result the LAST case carries, verbatim: the model must answer from it.
    expect(seen[2].toolResults?.[0].output).toBe(ANSWER_CASES[ANSWER_CASES.length - 1].result);
  });
});
