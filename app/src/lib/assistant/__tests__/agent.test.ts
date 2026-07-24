import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAssistantTurn, truncateHistory, sliceAfterContextBoundary, isContextNearlyFull } from '../agent';
import { MockProvider } from '../providers/mock';
import type { AssistantHost, AssistantMessage } from '../types';
import { asProfileId } from '../../../api/types';
import { ASSISTANT } from '../../zmninja-ng-constants';

// Asserted against below: the mutating API must never be reached from the
// agent loop, since the tools that called it no longer exist.
vi.mock('../../../api/monitors', () => ({ setMonitorEnabled: vi.fn() }));

function host(): AssistantHost {
  return { navigate: vi.fn(), onActivity: vi.fn() };
}
const baseOpts = (provider: MockProvider, h: AssistantHost, history: AssistantMessage[]) => ({
  provider, host: h, history,
  ctx: { profileId: asProfileId('p1'), queryClient: {} as never, host: h },
  system: 'sys', signal: new AbortController().signal,
});

describe('argument normalization before a tool runs', () => {
  afterEach(() => vi.restoreAllMocks());

  // End to end: the loop must hand the tool a clean input, not just have a
  // helper that could.
  it('strips the null-filled arguments before calling the tool', async () => {
    const execute = vi.fn().mockResolvedValue({ output: '{"matchCount":0}' });
    const stubTool = {
      name: 'list_events', description: 'd', schema: { type: 'object', properties: {} }, execute,
    } as never;

    const p = new MockProvider();
    p.setScript([
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'list_events',
            input: { eventIds: null, limit: 25, when: 'today', monitorId: null, objectType: null, tag: null },
          },
        ],
      },
      { text: 'done', toolCalls: [] },
    ]);

    await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'summarize today' }]), tools: [stubTool] });

    expect(execute).toHaveBeenCalledWith({ limit: 25, when: 'today' }, expect.anything());
  });

  // Weak models (Apple FM, qwen) call count_events with the tool's OWN internal
  // `{"interval":"1 day"}` shape. additionalProperties:false + required
  // lastCount/lastUnit would reject it; the pre-validation repair splits it so
  // the call runs instead of looping on the rejection (refs #270).
  it('repairs a count_events interval string into lastCount + lastUnit', async () => {
    const execute = vi.fn().mockResolvedValue({ output: '{"total":10}' });
    const countTool = {
      name: 'count_events',
      description: 'd',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['lastCount', 'lastUnit'],
        properties: {
          lastCount: { type: 'number' },
          lastUnit: { type: 'string', enum: ['minute', 'hour', 'day', 'week', 'month'] },
        },
      },
      execute,
    } as never;

    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'count_events', input: { interval: '1 day' } }] },
      { text: 'done', toolCalls: [] },
    ]);

    await runAssistantTurn({
      ...baseOpts(p, host(), [{ role: 'user', text: 'how many events today?' }]),
      tools: [countTool],
    });

    expect(execute).toHaveBeenCalledWith({ lastCount: 1, lastUnit: 'day' }, expect.anything());
  });
});

describe('a turn given no tools', () => {
  // The deadlock this prevents: triage called "summarize yesterday" CHAT, so
  // the turn ran with no tools, while the live-data rule still demanded a tool
  // call. The model called list_events, was told no tools were available,
  // answered, was told to call a tool, and went round to the iteration cap.
  it('does not demand a tool call it cannot make', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'Here is a plain answer.', toolCalls: [] }]);

    const out = await runAssistantTurn({
      ...baseOpts(p, host(), [{ role: 'user', text: 'summarize yesterday' }]),
      tools: [],
    });

    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Here is a plain answer.');
  });

  // The English keyword requirement is gone (refs #265); what remains is the
  // language-neutral nudge: one reminder for a tool-less answer, then the
  // second answer is accepted rather than replaced.
  it('nudges once, then accepts, when the model answers a data question without tools', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: 'I think nothing happened.', toolCalls: [] },
      { text: 'Still nothing.', toolCalls: [] },
    ]);

    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'summarize yesterday' }]));

    expect(out[out.length - 1].text).toBe('Still nothing.');
  });

  // The English regexes cannot see a German question, so a tool-less answer to
  // one gets a single language-neutral reminder (refs #259). Unlike the
  // specific requirement, a second tool-less answer is accepted, not replaced:
  // without the regex there is no certainty data was required.
  it('nudges a tool-less answer once in any language, then accepts it', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: 'Gestern gab es drei Ereignisse.', toolCalls: [] },
      { text: 'Gestern gab es drei Ereignisse.', toolCalls: [] },
    ]);

    const chatSpy = vi.spyOn(p, 'chat');
    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'Was ist gestern passiert?' }]));

    expect(out[out.length - 1].text).toBe('Gestern gab es drei Ereignisse.');
    // Two provider calls: answer, reminder, same answer accepted.
    expect(chatSpy).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});

describe('turn trace', () => {
  // The question and the triage round are produced before the loop starts, so
  // they arrive as `initialTrace`. Wiring them in is easy to drop silently:
  // the transcript still renders, it just opens mid-turn with no sign of what
  // was asked.
  it('keeps the seeded entries at the front of the saved trace', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'answer', toolCalls: [] }]);

    const out = await runAssistantTurn({
      ...baseOpts(p, host(), [{ role: 'user', text: 'how many vehicles came yesterday?' }]),
      initialTrace: [{ kind: 'question', text: 'how many vehicles came yesterday?' }],
    });

    const trace = out[out.length - 1].trace ?? [];
    expect(trace[0]).toEqual({ kind: 'question', text: 'how many vehicles came yesterday?' });
  });
});

describe('grounding check', () => {
  afterEach(() => vi.restoreAllMocks());

  const RESULT =
    '{"summary":"5 events between 00:00 and 09:31. By monitor: FrontDoor 2, Front Yard 2, Garage Outdoor 1. Detected: person 4, car 1.",' +
    '"matchCount":5,"events":[{"id":"1"}]}';

  async function runWithAnswers(answers: string[]) {
    const stubTool = {
      name: 'list_events',
      description: 'd',
      schema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ output: RESULT }),
    } as never;
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { when: 'today' } }] },
      ...answers.map((text) => ({ text, toolCalls: [] })),
    ]);
    const produced = await runAssistantTurn(
      { ...baseOpts(p, host(), [{ role: 'user', text: 'summarize today' }]), tools: [stubTool] },
    );
    return produced.at(-1)!;
  }

  it('accepts a grounded answer without spending a retry', async () => {
    const msg = await runWithAnswers(['There were 5 events today: 4 people and 1 car.']);
    expect(msg.text).toBe('There were 5 events today: 4 people and 1 car.');
  });

  it('retries an answer that denies the data, and takes the corrected one', async () => {
    const msg = await runWithAnswers([
      'No events were found today.',
      'There were 5 events today: 4 people and 1 car.',
    ]);
    expect(msg.text).toBe('There were 5 events today: 4 people and 1 car.');
  });

  it('retries an answer that echoes the raw tool result', async () => {
    const msg = await runWithAnswers([RESULT, 'There were 5 events today.']);
    expect(msg.text).toBe('There were 5 events today.');
  });

  // The guarantee: whatever the model does, the user is never told something
  // the data contradicts.
  it('answers from the tool summary when the model stays ungrounded', async () => {
    const msg = await runWithAnswers(['No events were found today.', 'Nothing was recorded today.']);
    expect(msg.text).toContain('5 events between 00:00 and 09:31');
    expect(msg.text).not.toContain('Nothing was recorded');
  });

  it('leaves an honest empty answer alone when the data really is empty', async () => {
    const stubTool = {
      name: 'list_events',
      description: 'd',
      schema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ output: '{"summary":"No events today.","matchCount":0,"events":[]}' }),
    } as never;
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { when: 'today' } }] },
      { text: 'No events were recorded today.', toolCalls: [] },
    ]);
    const produced = await runAssistantTurn(
      { ...baseOpts(p, host(), [{ role: 'user', text: 'summarize today' }]), tools: [stubTool] },
    );
    expect(produced.at(-1)!.text).toBe('No events were recorded today.');
  });
});

describe('truncateHistory turn cap', () => {
  const turn = (n: number) => [
    { role: 'user' as const, text: `question ${n}` },
    { role: 'assistant' as const, text: `answer ${n}` },
  ];

  it('keeps only the most recent turns', () => {
    const history = [...turn(1), ...turn(2), ...turn(3), ...turn(4)];
    const out = truncateHistory(history, 100, Number.POSITIVE_INFINITY, 2);
    expect(out.map((m) => m.text)).toEqual(['question 3', 'answer 3', 'question 4', 'answer 4']);
  });

  it('drops an old wrong answer that a small model would otherwise read as precedent', () => {
    // The live failure: six prior exchanges were replayed every turn, two of
    // them carrying answers that were wrong at the time.
    const history = [
      { role: 'user' as const, text: 'summarize today' },
      { role: 'assistant' as const, text: 'No event was found for just today.' },
      ...turn(2),
      ...turn(3),
      ...turn(4),
    ];
    const out = truncateHistory(history, 100, Number.POSITIVE_INFINITY, 2);
    expect(out.some((m) => m.text?.includes('No event was found'))).toBe(false);
  });

  it('never evicts the turn being answered, however low the cap', () => {
    const history = [...turn(1), ...turn(2), { role: 'user' as const, text: 'summarize today' }];
    const out = truncateHistory(history, 100, Number.POSITIVE_INFINITY, 1);
    expect(out.at(-1)?.text).toBe('summarize today');
  });

  it('is unbounded by default so existing callers are unaffected', () => {
    const history = [...turn(1), ...turn(2), ...turn(3)];
    expect(truncateHistory(history, 100)).toHaveLength(6);
  });
});

describe('truncateHistory', () => {
  it('drops whole tool turns, never leaving an orphan tool result', () => {
    const h: AssistantMessage[] = [
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 't', input: {} }] },
      { role: 'tool', toolResults: [{ callId: 'c1', output: 'x' }] },
      { role: 'user', text: 'again' },
    ];
    const out = truncateHistory(h, 2);
    expect(out[0].role).not.toBe('tool');
  });

  // Trimming drops the oldest messages, and in a multi-tool turn the oldest
  // message is the user's question. "Summarize today" made two tool calls and
  // left the model holding results with no idea what had been asked.
  it('never drops the question being answered, however tight the budget', () => {
    const bulky = 'x'.repeat(5000);
    const out = truncateHistory(
      [
        { role: 'user', text: 'summarize today' },
        { role: 'assistant', toolCalls: [{ id: 'c1', name: 'list_events', input: {} }] },
        { role: 'tool', toolResults: [{ callId: 'c1', output: bulky }] },
        { role: 'assistant', toolCalls: [{ id: 'c2', name: 'count_events', input: {} }] },
        { role: 'tool', toolResults: [{ callId: 'c2', output: bulky }] },
      ],
      40,
      6000,
    );

    expect(out.some((m) => m.text === 'summarize today')).toBe(true);
  });

  // A realistic daily summary: three tool calls, each returning a full-size
  // list_events payload, must still fit whole.
  it('holds a three-tool turn with full-size results inside the budget', () => {
    const result = JSON.stringify({
      events: Array.from({ length: ASSISTANT.maxListEventsLimit }, (_, i) => ({
        id: String(i), monitor: 'Garage Outdoor', start: '2026-07-19 07:17:21', durationSec: 12.5, objects: ['person'],
      })),
    });
    const history: AssistantMessage[] = [{ role: 'user', text: 'summarize today' }];
    for (const name of ['list_events', 'count_events', 'get_server_health']) {
      history.push({ role: 'assistant', toolCalls: [{ id: name, name, input: {} }] });
      history.push({ role: 'tool', toolResults: [{ callId: name, output: result }] });
    }

    const out = truncateHistory(history, ASSISTANT.maxHistoryMessages, ASSISTANT.maxHistoryCharacters);

    expect(out).toHaveLength(history.length);
  });

  it('keeps recent messages within the character budget, dropping older ones', () => {
    const out = truncateHistory(
      [
        { role: 'user', text: 'the question' },
        { role: 'assistant', text: 'old '.repeat(100) },
        { role: 'assistant', text: 'recent' },
      ],
      40,
      100,
    );

    // The bulky middle turn is dropped; the question is pinned regardless of
    // budget (see the test above), so it stays alongside the recent message.
    expect(out).toEqual([
      { role: 'user', text: 'the question' },
      { role: 'assistant', text: 'recent' },
    ]);
  });
});

describe('history budget counts only what the model is sent', () => {
  // The Ollama loop this came from: a twelve-event list_events result is ~200
  // characters of output and ~17000 once its result cards are counted. The
  // budget saw the cards, dropped the tool call and its result, and the model
  // re-asked the same question every round having never been told the answer.
  it('ignores result cards, which are UI-only and never reach the model', () => {
    const token = 'a'.repeat(600);
    const display = Array.from({ length: 12 }, (_, i) => ({
      kind: 'event' as const,
      id: String(i),
      title: 'Event',
      navigatePath: `/events/${i}`,
      imageUrls: [`https://host/zm?eid=${i}&token=${token}`, `https://host/zm?eid=${i}&fid=alarm&token=${token}`],
    }));
    const history: AssistantMessage[] = [
      { role: 'user', text: 'summarize yesterday' },
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 'list_events', input: { when: 'yesterday' } }] },
      { role: 'tool', toolResults: [{ callId: 'c1', output: '{"matchCount":12}', display }] },
    ];

    expect(truncateHistory(history, 40, 12000)).toHaveLength(3);
  });

  it('still counts the output the model does see', () => {
    const history: AssistantMessage[] = [
      { role: 'user', text: 'q' },
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 'list_events', input: {} }] },
      { role: 'tool', toolResults: [{ callId: 'c1', output: 'x'.repeat(20_000) }] },
    ];

    // Over budget on real output: the question survives, the oversized turn
    // does not.
    expect(truncateHistory(history, 40, 12000).map((m) => m.role)).toEqual(['user']);
  });
});

describe('sliceAfterContextBoundary', () => {
  it('returns everything when no message is a boundary', () => {
    const h: AssistantMessage[] = [
      { role: 'user', text: 'a' },
      { role: 'assistant', text: 'b' },
    ];
    expect(sliceAfterContextBoundary(h)).toEqual(h);
  });

  it('drops the boundary message and everything before it', () => {
    const h: AssistantMessage[] = [
      { role: 'user', text: 'old question' },
      { role: 'assistant', text: 'old answer' },
      { role: 'assistant', text: '__i18n:assistant.context_cleared', contextBoundary: true },
      { role: 'user', text: 'new question' },
    ];
    expect(sliceAfterContextBoundary(h)).toEqual([{ role: 'user', text: 'new question' }]);
  });

  it('honours the LAST boundary when a thread has been cleared more than once', () => {
    const h: AssistantMessage[] = [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'cleared once', contextBoundary: true },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: 'cleared twice', contextBoundary: true },
      { role: 'user', text: 'third' },
    ];
    expect(sliceAfterContextBoundary(h)).toEqual([{ role: 'user', text: 'third' }]);
  });

  it('returns empty when the boundary is the last message', () => {
    const h: AssistantMessage[] = [
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'cleared', contextBoundary: true },
    ];
    expect(sliceAfterContextBoundary(h)).toEqual([]);
  });
});

describe('isContextNearlyFull', () => {
  const window = 8192;
  const at = (promptTokens: number) => ({ promptTokens, completionTokens: 0, totalTokens: promptTokens });

  it('is false well below the threshold', () => {
    expect(isContextNearlyFull(window, at(1000))).toBe(false);
  });

  it('is true at or past the threshold', () => {
    const threshold = window * ASSISTANT.contextClearThreshold;
    expect(isContextNearlyFull(window, at(threshold))).toBe(true);
    expect(isContextNearlyFull(window, at(threshold + 1))).toBe(true);
  });

  it('is false just under the threshold', () => {
    expect(isContextNearlyFull(window, at(window * ASSISTANT.contextClearThreshold - 1))).toBe(false);
  });

  // Ollama: the window is the server's num_ctx and nothing reports it, so
  // there is no fraction to compute. Guessing one would clear conversations
  // that were never close to full.
  it('is false when the backend does not report a context window', () => {
    expect(isContextNearlyFull(undefined, at(999999))).toBe(false);
  });

  it('is false when the backend reported no usage', () => {
    expect(isContextNearlyFull(window, undefined)).toBe(false);
  });

  // Tool results are appended DURING a turn, so a turn that was inside budget
  // when it started could grow past it by the time it answered. The auto-clear
  // check only acts between turns and cannot catch that.
  it('re-bounds the history between tool iterations, not just at the turn start', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { a: 1 } }] },
      { toolCalls: [{ id: 'c2', name: 'list_events', input: { b: 2 } }] },
      { text: 'done', toolCalls: [] },
    ]);
    // Each result is most of the character budget on its own.
    const execute = vi.fn().mockResolvedValue({ output: 'x'.repeat(ASSISTANT.maxHistoryCharacters - 100) });
    const stubTool = {
      name: 'list_events', description: '', schema: {}, execute,
    } as never;
    const sizes: number[] = [];
    vi.spyOn(p, 'chat').mockImplementation(async (messages) => {
      sizes.push(messages.reduce((n, m) => n + (m.text?.length ?? 0) + JSON.stringify(m.toolResults ?? '').length, 0));
      const scripted = sizes.length === 1
        ? { toolCalls: [{ id: 'c1', name: 'list_events', input: { a: 1 } }] }
        : sizes.length === 2
          ? { toolCalls: [{ id: 'c2', name: 'list_events', input: { b: 2 } }] }
          : { text: 'done', toolCalls: [] };
      return scripted as never;
    });

    await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'q' }]), tools: [stubTool] });

    // Two large results were appended, yet the prompt never carried both.
    expect(Math.max(...sizes)).toBeLessThan(ASSISTANT.maxHistoryCharacters * 2);
    vi.restoreAllMocks();
  });

  it('leaves room for the next turn to answer, not just to fit', () => {
    // The threshold has to clear the reply the NEXT turn still has to
    // generate, otherwise the turn that discovers the overflow is the turn
    // that fails on it.
    const headroom = window - window * ASSISTANT.contextClearThreshold;
    expect(headroom).toBeGreaterThan(ASSISTANT.maxTokens);
  });
});

describe('runAssistantTurn', () => {
  it('sends only the messages after a context boundary to the provider', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'answer', toolCalls: [] }]);
    // Snapshot at call time: runAssistantTurn pushes each turn onto the same
    // array it hands to `chat`, so the spy's captured reference would have
    // grown by the time we assert on it.
    let sent: AssistantMessage[] = [];
    vi.spyOn(p, 'chat').mockImplementation(async (messages) => {
      sent = structuredClone(messages);
      return { text: 'answer', toolCalls: [] };
    });
    await runAssistantTurn({
      ...baseOpts(p, host(), [
        { role: 'user', text: 'ancient history' },
        { role: 'assistant', text: 'cleared', contextBoundary: true },
        { role: 'user', text: 'fresh question' },
      ]),
      // No tools: this test is about history mechanics, and a tool-less answer
      // with tools available would trip the generic live-data reminder.
      tools: [],
    });
    // The pre-boundary messages are gone from what the model sees: that IS the
    // clear. Leaving them would make the auto-clear cosmetic.
    expect(sent).toEqual([{ role: 'user', text: 'fresh question' }]);
    vi.restoreAllMocks();
  });

  // AskPanel appends whatever comes back onto the thread it already holds, so
  // the return value must be ONLY what this turn produced. Returning the input
  // history too made the caller compensate with `result.slice(history.length)`,
  // which silently dropped the answer whenever the agent had trimmed the
  // history it was given: the returned array was then SHORTER than the thread,
  // so the slice came back empty. Truncation at maxHistoryMessages (40) and an
  // auto-clear boundary both trim, so both lost the answer.
  it('returns only this turn\'s new messages, even when the input history was trimmed', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'answer', toolCalls: [] }]);
    const long: AssistantMessage[] = Array.from({ length: ASSISTANT.maxHistoryMessages + 5 }, (_, i) => ({
      role: 'user' as const,
      text: `msg ${i}`,
    }));
    const out = await runAssistantTurn({ ...baseOpts(p, host(), long), tools: [] });
    expect(out).toEqual([{ role: 'assistant', text: 'answer', toolCalls: [], raw: undefined, display: undefined, usage: undefined }]);
  });

  it('returns only this turn\'s new messages after a context boundary', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'answer', toolCalls: [] }]);
    const out = await runAssistantTurn({
      ...baseOpts(p, host(), [
        { role: 'user', text: 'old' },
        { role: 'assistant', text: 'cleared', contextBoundary: true },
        { role: 'user', text: 'new' },
      ]),
      tools: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('answer');
  });

  it('attaches the provider-reported usage to the final assistant message', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: 'answer', toolCalls: [], usage: { promptTokens: 1200, completionTokens: 30, totalTokens: 1230 } },
    ]);
    const out = await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'q' }]), tools: [] });
    expect(out[out.length - 1].usage).toEqual({ promptTokens: 1200, completionTokens: 30, totalTokens: 1230 });
  });

  it('carries the LAST iteration usage, so a tool-calling turn reports its real prompt size', async () => {
    const p = new MockProvider();
    p.setScript([
      {
        toolCalls: [{ id: 'c1', name: 'list_monitors', input: {} }],
        usage: { promptTokens: 900, completionTokens: 10, totalTokens: 910 },
      },
      // The second call re-sends the history PLUS the tool result, so its
      // prompt is the larger one; reporting the first would understate how
      // full the window is.
      { text: 'done', toolCalls: [], usage: { promptTokens: 1500, completionTokens: 20, totalTokens: 1520 } },
    ]);
    const stubTool = {
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]' }),
    } as never;
    const out = await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'q' }]), tools: [stubTool] });
    expect(out[out.length - 1].usage?.promptTokens).toBe(1500);
    vi.restoreAllMocks();
  });

  // Observed on-device: asked "how many people came home today", the model
  // called count_events {"interval":"1 day"} three times (that tool reports
  // counts only, never object types) and then answered from data that could
  // not contain the answer. An identical repeat cannot return anything new,
  // so it is refused rather than re-run (refs #246).
  it('refuses a tool call repeated with identical arguments instead of re-running it', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'count_events', input: { interval: '1 day' } }] },
      { toolCalls: [{ id: 'c2', name: 'count_events', input: { interval: '1 day' } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const execute = vi.fn().mockResolvedValue({ output: '{"total":15}' });
    const stubTool = {
      name: 'count_events', description: '', schema: {}, execute,
    } as never;

    // "how many events" rather than "how many people": count_events is now
    // refused outright for an object-type question (objectQuestionMismatch),
    // and this test is about the repeat guard, not about tool choice.
    const out = await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'how many events today' }]), tools: [stubTool] });

    expect(execute).toHaveBeenCalledTimes(1);
    const repeat = out.filter((m) => m.role === 'tool')[1];
    expect(repeat?.toolResults?.[0].isError).toBe(true);
    expect(repeat?.toolResults?.[0].output).toContain('already called count_events');
    vi.restoreAllMocks();
  });

  // A schema-rejected call must not leave the model free to answer from
  // nothing. Observed on-device: count_events rejected with "lastCount is
  // required" was followed by a fabricated "There were 10 events recorded
  // today". The result now carries the two allowed moves and a ban on
  // inventing facts (refs #270).
  it('appends the do-not-fabricate guard to a schema-rejected tool result', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'count_events', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const execute = vi.fn().mockResolvedValue({ output: '{"total":15}' });
    const stubTool = {
      name: 'count_events', description: '',
      schema: { type: 'object', properties: {}, required: ['lastCount'] }, execute,
    } as never;

    const out = await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'how many events today' }]), tools: [stubTool] });

    const result = out.find((m) => m.role === 'tool')?.toolResults?.[0];
    expect(execute).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.output).toContain('lastCount is required');
    expect(result?.output).toContain('Never state counts');
    vi.restoreAllMocks();
  });

  it('still allows the same tool with different arguments', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { objectType: 'people' } }] },
      { toolCalls: [{ id: 'c2', name: 'list_events', input: { objectType: 'person' } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const execute = vi.fn().mockResolvedValue({ output: '{"events":[]}' });
    const stubTool = {
      name: 'list_events', description: '', schema: {}, execute,
    } as never;

    await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'how many people today' }]), tools: [stubTool] });

    expect(execute).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  // The actions that changed state were deleted, so a model asking for one
  // resolves to no tool at all: there is nothing to run and nothing to confirm.
  it('refuses a withheld action and explains why, rather than running anything', async () => {
    const { setMonitorEnabled } = await import('../../../api/monitors');
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'set_monitor_enabled', input: { monitorId: '4', enabled: false } }] },
      { text: 'I cannot change that. Disarm it on the Monitors screen.', toolCalls: [] },
    ]);

    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'disarm 4' }]));

    const result = out.find((m) => m.role === 'tool')?.toolResults?.[0];
    expect(result?.isError).toBe(true);
    expect(result?.output).toContain('not something this assistant can do');
    expect(vi.mocked(setMonitorEnabled)).not.toHaveBeenCalled();
  });

  // A genuinely unknown name must stay distinguishable from a withheld one, or
  // the model is told the wrong thing about why its call failed.
  it('still reports an unknown tool name as unknown', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'launch_missiles', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);

    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'q' }]));

    expect(out.find((m) => m.role === 'tool')?.toolResults?.[0].output).toBe('Unknown tool: launch_missiles');
  });


  it('requires list_events before answering a daily summary', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: 'Invented daily summary', toolCalls: [] },
      { toolCalls: [{ id: 'events', name: 'list_events', input: { range: 'today' } }] },
      { text: 'One event today.', toolCalls: [] },
    ]);
    const h = host();
    const stubTool = {
      name: 'list_events', description: '', schema: {}, destructive: false,
      execute: async () => ({
        output: '[{"id":"1"}]',
        display: [{ kind: 'event', id: '1', title: 'Front Door', navigatePath: '/events/1', imageUrls: ['thumb'] }],
      }),
    } as never;

    const out = await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'Summarize my day' }]), tools: [stubTool] });

    expect(out.map((message) => message.text)).not.toContain('Invented daily summary');
    expect(h.onActivity).toHaveBeenCalledWith({ toolName: 'list_events', status: 'done', input: { range: 'today' } });
    expect(out[out.length - 1]).toMatchObject({
      text: 'One event today.',
      display: [{ kind: 'event', id: '1', imageUrls: ['thumb'] }],
    });
    vi.restoreAllMocks();
  });

  it('requires a monitor tool before answering current camera state', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: 'Front Door is armed.', toolCalls: [] },
      { toolCalls: [{ id: 'monitors', name: 'list_monitors', input: {} }] },
      { text: 'Front Door is connected.', toolCalls: [] },
    ]);
    const h = host();
    const stubTool = {
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[{"name":"Front Door","status":"Connected"}]' }),
    } as never;

    const out = await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'What is my camera status?' }]), tools: [stubTool] });

    expect(out.map((message) => message.text)).not.toContain('Front Door is armed.');
    expect(h.onActivity).toHaveBeenCalledWith({ toolName: 'list_monitors', status: 'done', input: {} });
    expect(out[out.length - 1].text).toBe('Front Door is connected.');
    vi.restoreAllMocks();
  });

  it('stops at the iteration cap', async () => {
    const p = new MockProvider();
    p.setScript(Array.from({ length: 10 }, () => ({ toolCalls: [{ id: 'c', name: 'list_monitors', input: {} }] })));
    const h = host();
    const stubTool = {
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]' }),
    } as never;
    const out = await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'go' }]), tools: [stubTool] });
    // Deviation from the brief's literal assertion (see agent.test.ts / task-6-report.md):
    // agent.ts pushes the untranslated `__i18n:<key>` sentinel per the brief's own note
    // ("localized by the panel at render; see Task 8"), never English prose, per rule 5.
    // Assert the sentinel/key instead of the prose the brief's test checked for.
    expect(out[out.length - 1].text).toContain('assistant.iteration_cap_reached');
  });

  it('carries a parse-error turn\'s `raw` onto the pushed assistant message', async () => {
    const p = new MockProvider();
    p.setScript([{ text: '__i18n:assistant.parse_error', toolCalls: [], raw: 'not json at all' }]);
    const h = host();
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'hi' }]));
    const assistantMsg = out.find((m) => m.role === 'assistant');
    expect(assistantMsg?.raw).toBe('not json at all');
  });

  it('reports the tool call input on every onActivity call (refs #246)', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'count_events', input: { interval: '24 hour' } }] },
      { text: 'Front Door was the most active.', toolCalls: [] },
    ]);
    const h = host();
    const stubTool = {
      name: 'count_events', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{"Front Door": 5}' }),
    } as never;
    await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'which monitor was most active?' }]), tools: [stubTool] });

    expect(h.onActivity).toHaveBeenCalledWith({
      toolName: 'count_events',
      status: 'running',
      input: { interval: '24 hour' },
    });
    expect(h.onActivity).toHaveBeenCalledWith({
      toolName: 'count_events',
      status: 'done',
      input: { interval: '24 hour' },
    });
  });

  it('aggregates a tool\'s display cards onto the FINAL assistant message, not the tool message (refs #246)', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_monitors', input: {} }] },
      { text: 'Front Door is enabled.', toolCalls: [] },
    ]);
    const h = host();
    const display = [
      { kind: 'monitor' as const, id: '1', title: 'Front Door', navigatePath: '/monitors/1' },
    ];
    const stubTool = {
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]', display }),
    } as never;
    const out = await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'list monitors' }]), tools: [stubTool] });
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.display).toBeUndefined();
    const finalMsg = out[out.length - 1];
    expect(finalMsg.role).toBe('assistant');
    expect(finalMsg.text).toBe('Front Door is enabled.');
    expect(finalMsg.display).toEqual(display);
  });

  // The SHOW directive (refs #264): the model names the ids its answer is
  // about, the line comes off the text, and only those cards render.
  it('strips a SHOW directive from the answer and narrows the cards to its ids', async () => {
    const display = [
      { kind: 'event', id: '101', title: 'a', navigatePath: '/events/101' },
      { kind: 'event', id: '102', title: 'b', navigatePath: '/events/102' },
      { kind: 'event', id: '103', title: 'c', navigatePath: '/events/103' },
    ];
    const stubTool = {
      name: 'list_events', description: '', schema: {},
      execute: async () => ({ output: '{"matchCount":3}', display }),
    } as never;
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { when: 'today' } }] },
      { text: 'The two that matter happened at 8 AM.\nSHOW: events=101,103', toolCalls: [] },
    ]);

    const out = await runAssistantTurn({ ...baseOpts(p, host(), [{ role: 'user', text: 'summarize today' }]), tools: [stubTool] });

    const finalMsg = out[out.length - 1];
    expect(finalMsg.text).toBe('The two that matter happened at 8 AM.');
    expect(finalMsg.display?.map((d) => d.id)).toEqual(['101', '103']);
  });

  it('leaves display undefined on the final message when no tool call returned display', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'get_server_health', input: {} }] },
      { text: 'All good.', toolCalls: [] },
    ]);
    const h = host();
    const stubTool = {
      name: 'get_server_health', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{}' }),
    } as never;
    const out = await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'is the server ok?' }]), tools: [stubTool] });
    const finalMsg = out[out.length - 1];
    expect(finalMsg.display).toBeUndefined();
  });

  it('de-dupes display cards across iterations by kind+id and drops intermediate duplicates', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: {} }] },
      { toolCalls: [{ id: 'c2', name: 'get_event', input: { eventId: '42' } }] },
      { text: 'Here is that event.', toolCalls: [] },
    ]);
    const h = host();
    const card = { kind: 'event' as const, id: '42', title: 'Front Door · today', navigatePath: '/events/42' };
    const stubTool = {
      name: 'list_events', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{}', display: [card] }),
    } as never;
    const stubTool2 = {
      name: 'get_event', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{}', display: [card] }),
    } as never;
    const out = await runAssistantTurn({ ...baseOpts(p, h, [{ role: 'user', text: 'tell me about event 42' }]), tools: [stubTool, stubTool2] });
    const finalMsg = out[out.length - 1];
    expect(finalMsg.display).toEqual([card]);
  });
});

// A backend whose own runtime drives the tool loop (the apple backend, refs
// #270): it executes through the `runTool` callback and returns the finished
// answer with `nativeToolResults` set. The turn must come out of the agent in
// the same shape the loop path produces, or the transcript, the result cards
// and the persisted thread would differ by backend.
describe('a provider that runs the tool loop natively', () => {
  const card = { kind: 'event' as const, id: '42', title: 'Front Door', navigatePath: '/events/42' };
  const stubTool = {
    name: 'list_events', description: '', schema: { type: 'object', properties: {} }, destructive: false,
    execute: async () => ({ output: '{"matchCount":1}', display: [card] }),
  } as never;

  /** Answers by calling one tool through `runTool`, the way the native loop does. */
  class NativeProvider {
    complete = vi.fn();
    async chat(
      _messages: AssistantMessage[],
      _tools: never,
      _system: string,
      _signal: AbortSignal,
      _onStatus?: unknown,
      runTool?: (name: string, input: Record<string, unknown>) => Promise<never>,
    ) {
      const result = await runTool!('list_events', { when: 'today' });
      return {
        text: 'One event today.',
        toolCalls: [],
        nativeToolResults: [result],
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      };
    }
  }

  it('produces the same history, trace, display and activity shape as the loop path', async () => {
    const h = host();
    const traced: unknown[] = [];
    const native = await runAssistantTurn({
      ...baseOpts(new NativeProvider() as never, h, [{ role: 'user', text: 'what happened today?' }]),
      host: { ...h, onTrace: (e) => traced.push(e) },
      tools: [stubTool],
    });

    const loopProvider = new MockProvider();
    loopProvider.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { when: 'today' } }] },
      { text: 'One event today.', toolCalls: [] },
    ]);
    const loop = await runAssistantTurn({
      ...baseOpts(loopProvider, host(), [{ role: 'user', text: 'what happened today?' }]),
      tools: [stubTool],
    });

    // The loop path opens with the tool-call assistant message the model sent;
    // a native turn has none to report, so it starts at the results.
    expect(native.map((m) => m.role)).toEqual(['tool', 'assistant']);
    expect(loop.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    // The tool message carries the same executed result, plus the name/input
    // the native runtime chose.
    expect(native[0].toolResults).toEqual([
      { ...loop[1].toolResults![0], callId: 'native-1', name: 'list_events', input: { when: 'today' } },
    ]);
    // The answer message is identical in every field the panel renders.
    const strip = (m: AssistantMessage) => ({ text: m.text, toolCalls: m.toolCalls, display: m.display, trace: m.trace });
    expect(strip(native[1])).toEqual(strip(loop[2]));
    expect(native[1].display).toEqual([card]);
    expect(native[1].usage).toEqual({ promptTokens: 100, completionTokens: 10, totalTokens: 110 });
    // The tool ran through the same machinery: one trace entry, and the
    // running/done activity pair.
    expect(traced).toEqual([
      { kind: 'tool', name: 'list_events', input: { when: 'today' }, output: '{"matchCount":1}', isError: undefined, apiCalls: [] },
    ]);
    expect((h.onActivity as ReturnType<typeof vi.fn>).mock.calls.map(([a]) => a.status)).toEqual(['running', 'done']);
  });

  // A native turn cut short at its tool-call budget comes back with the data
  // and no prose (see chatWithNativeTools): the answer is built from the tool's
  // own summary rather than shown as an empty bubble.
  it('answers from the tool summary when a native turn returns no text', async () => {
    const summaryTool = {
      name: 'list_events', description: '', schema: { type: 'object', properties: {} }, destructive: false,
      execute: async () => ({ output: '{"summary":"1 event today.","matchCount":1}' }),
    } as never;
    class SilentNativeProvider {
      complete = vi.fn();
      async chat(
        _messages: AssistantMessage[],
        _tools: never,
        _system: string,
        _signal: AbortSignal,
        _onStatus?: unknown,
        runTool?: (name: string, input: Record<string, unknown>) => Promise<never>,
      ) {
        const result = await runTool!('list_events', { when: 'today' });
        return { text: '', toolCalls: [], nativeToolResults: [result] };
      }
    }

    const out = await runAssistantTurn({
      ...baseOpts(new SilentNativeProvider() as never, host(), [{ role: 'user', text: 'what happened today?' }]),
      tools: [summaryTool],
    });

    expect(out[out.length - 1].text).toBe('1 event today.');
  });
});
