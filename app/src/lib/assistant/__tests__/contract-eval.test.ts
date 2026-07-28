/**
 * The on-device tool-contract eval (refs #270).
 *
 * The point of this eval is that it works for BOTH kinds of backend: one that
 * returns tool calls for the agent to run (Gemini Nano, WebLLM, llama.cpp) and one
 * that runs its own tool loop and only reveals its calls by executing them (Apple).
 * Both shapes are exercised here, because scoring the wrong path for Apple would
 * silently measure a code path production does not use.
 */
import { describe, it, expect, vi } from 'vitest';
import { runContractEval, CONTRACT_EVAL_CASE_COUNT } from '../contract-eval';
import { TOOL_CASES } from '../contract-eval-cases';
import type { AssistantMessage, AssistantProvider, AssistantTurn, ExecutedToolCall, ToolDefinition } from '../types';

vi.mock('../../logger', () => ({
  log: { assistant: vi.fn() },
  LogLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

/** A provider whose reply for each question is scripted by `answer`. */
function providerFrom(
  answer: (q: string) => AssistantTurn | { native: Array<{ name: string; input: Record<string, unknown> }> },
): AssistantProvider {
  return {
    complete: vi.fn(),
    chat: async (
      messages: AssistantMessage[],
      _tools: ToolDefinition[],
      _system: string,
      _signal: AbortSignal,
      _onStatus?: unknown,
      runTool?: (name: string, input: Record<string, unknown>) => Promise<ExecutedToolCall>,
    ) => {
      const q = messages[0]?.text ?? '';
      const scripted = answer(q);
      if ('native' in scripted) {
        // The Apple shape: execute through runTool, return prose, no toolCalls.
        for (const call of scripted.native) await runTool?.(call.name, call.input);
        return { text: 'Done.', toolCalls: [] };
      }
      return scripted;
    },
  } as unknown as AssistantProvider;
}

/** The expectation the shared case list holds for one question. */
function caseFor(q: string) {
  const c = TOOL_CASES.find((x) => x.q === q);
  if (!c) throw new Error(`no case for ${q}`);
  return c;
}

/** A tool call that satisfies whatever the case for `q` expects. */
function passingCall(q: string): { name: string; input: Record<string, unknown> } {
  const c = caseFor(q);
  const inputs: Record<string, Record<string, unknown>> = {
    'summarize today': { when: 'today' },
    'what happened yesterday': { when: 'yesterday' },
    'summarize last week': { when: 'last week' },
    'what happened in the past 2 weeks': { when: 'past 2 weeks' },
    'was war gestern bei mir los': { when: 'gestern' },
    'summarize april': { when: 'april' },
    'compare may to june': { when: 'may' },
    'how many people came today': { when: 'today', objectType: ['person'] },
    'how many vehicles came yesterday': { when: 'yesterday', objectType: ['car', 'truck'] },
    'what was my busiest hour yesterday': { when: 'yesterday' },
    'is the server ok': {},
    'what cameras do I have': {},
    'how many events in the last 24 hours': { lastUnit: 'hour', lastCount: 24 },
    'what tags are available': {},
  };
  return { name: c.tool as string, input: inputs[q] ?? {} };
}

const signal = () => new AbortController().signal;
const NOW = new Date('2026-07-19T18:00:00Z');

describe('runContractEval', () => {
  it('scores a perfect run from a backend that returns tool calls', async () => {
    const provider = providerFrom((q) => ({ text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] }) as AssistantTurn);
    const report = await runContractEval(provider, NOW, 'America/New_York', signal());

    expect(report.pass).toBe(CONTRACT_EVAL_CASE_COUNT);
    expect(report.failures).toEqual([]);
    // Triage cases are reported, never scored, exactly as prompt-eval treats them.
    expect(report.skippedTriaged).toBe(TOOL_CASES.filter((c) => c.triaged).length);
  });

  it('scores a backend that runs its own tool loop, reading the calls it executed', async () => {
    // No toolCalls on the turn at all: without runTool this backend would look
    // like it never called anything, which is the Apple failure mode this guards.
    const provider = providerFrom((q) => ({ native: [passingCall(q)] }));
    const report = await runContractEval(provider, NOW, 'America/New_York', signal());

    expect(report.pass).toBe(CONTRACT_EVAL_CASE_COUNT);
  });

  it('fails a case that calls the wrong tool, naming what it called', async () => {
    const provider = providerFrom((q) =>
      q === 'is the server ok'
        ? ({ text: undefined, toolCalls: [{ name: 'list_events', input: { when: 'today' }, id: 'c1' }] } as AssistantTurn)
        : ({ text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] } as AssistantTurn),
    );
    const report = await runContractEval(provider, NOW, 'America/New_York', signal());

    expect(report.pass).toBe(CONTRACT_EVAL_CASE_COUNT - 1);
    expect(report.failures).toEqual([{ q: 'is the server ok', expected: 'get_server_health', got: 'called list_events' }]);
  });

  it('fails a summary that drags an objectType along, the live fault the case exists for', async () => {
    const provider = providerFrom((q) =>
      q === 'summarize april'
        ? ({ text: undefined, toolCalls: [{ name: 'list_events', input: { when: 'april', objectType: ['car', 'person'] }, id: 'c1' }] } as AssistantTurn)
        : ({ text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] } as AssistantTurn),
    );
    const report = await runContractEval(provider, NOW, 'America/New_York', signal());

    expect(report.pass).toBe(CONTRACT_EVAL_CASE_COUNT - 1);
    expect(report.failures[0].q).toBe('summarize april');
    expect(report.failures[0].got).toContain('objectType');
  });

  it('checks every call on an allCalls case, not just the first', async () => {
    // "compare may to june": the second call is the one carrying the stray label.
    const provider = providerFrom((q) =>
      q === 'compare may to june'
        ? ({
            text: undefined,
            toolCalls: [
              { name: 'list_events', input: { when: 'may' }, id: 'c1' },
              { name: 'list_events', input: { when: 'june', objectType: ['car'] }, id: 'c2' },
            ],
          } as AssistantTurn)
        : ({ text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] } as AssistantTurn),
    );
    const report = await runContractEval(provider, NOW, 'America/New_York', signal());

    expect(report.failures.map((f) => f.q)).toEqual(['compare may to june']);
  });

  it('records a backend error as a failed case and keeps going', async () => {
    let calls = 0;
    const provider = providerFrom((q) => {
      calls += 1;
      if (q === 'summarize today') throw new Error('AICore said no');
      return { text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] } as AssistantTurn;
    });
    const report = await runContractEval(provider, NOW, 'America/New_York', signal());

    // Every case still ran: a run that dies on case one measures nothing.
    expect(calls).toBe(CONTRACT_EVAL_CASE_COUNT);
    expect(report.pass).toBe(CONTRACT_EVAL_CASE_COUNT - 1);
    expect(report.failures[0].got).toContain('AICore said no');
  });

  it('reports progress once per scored case', async () => {
    const provider = providerFrom((q) => ({ text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] }) as AssistantTurn);
    const seen: number[] = [];
    await runContractEval(provider, NOW, 'America/New_York', signal(), (done, total) => {
      seen.push(done);
      expect(total).toBe(CONTRACT_EVAL_CASE_COUNT);
    });
    expect(seen).toEqual(Array.from({ length: CONTRACT_EVAL_CASE_COUNT }, (_, i) => i + 1));
  });

  it('retries a rate-limited call instead of scoring it as a wrong answer', async () => {
    // AICore meters requests over a short window. A rate-limited call is not an
    // answer, and scoring it as one reported 0/14 on a real device once.
    const attempts = new Map<string, number>();
    const provider = providerFrom((q) => {
      const n = (attempts.get(q) ?? 0) + 1;
      attempts.set(q, n);
      if (n === 1) throw Object.assign(new Error('__i18n:assistant.gemini_rate_limited'), { code: 'RATE_LIMITED' });
      return { text: undefined, toolCalls: [{ ...passingCall(q), id: 'c1' }] } as AssistantTurn;
    });

    vi.useFakeTimers();
    const run = runContractEval(provider, NOW, 'America/New_York', signal());
    await vi.runAllTimersAsync();
    const report = await run;
    vi.useRealTimers();

    expect(report.pass).toBe(CONTRACT_EVAL_CASE_COUNT);
    expect(report.rateLimitedRetries).toBe(CONTRACT_EVAL_CASE_COUNT);
    expect(report.failures).toEqual([]);
  });

  it('gives up on a case that stays rate-limited, and says so', async () => {
    const provider = providerFrom(() => {
      throw Object.assign(new Error('__i18n:assistant.gemini_rate_limited'), { code: 'RATE_LIMITED' });
    });

    vi.useFakeTimers();
    const run = runContractEval(provider, NOW, 'America/New_York', signal());
    await vi.runAllTimersAsync();
    const report = await run;
    vi.useRealTimers();

    expect(report.pass).toBe(0);
    // The failure names the rate limit, so a zeroed run is never mistaken for a
    // model that got every question wrong.
    expect(report.failures[0].got).toContain('rate_limited');
  });
});
