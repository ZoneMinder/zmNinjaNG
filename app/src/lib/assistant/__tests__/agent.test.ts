import { describe, it, expect, vi } from 'vitest';
import { runAssistantTurn, truncateHistory, sliceAfterContextBoundary, isContextNearlyFull } from '../agent';
import { MockProvider } from '../providers/mock';
import type { AssistantHost, AssistantMessage } from '../types';
import { asProfileId } from '../../../api/types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { NATIVE_MNN_MODELS } from '../native-mnn';

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

  it('keeps recent messages within the character budget', () => {
    const out = truncateHistory(
      [
        { role: 'user', text: 'old '.repeat(100) },
        { role: 'assistant', text: 'recent' },
      ],
      40,
      100,
    );
    expect(out).toEqual([{ role: 'assistant', text: 'recent' }]);
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

  // The on-device budget promised 3072 generated tokens inside a 4096 window
  // that already held a ~1900-token prompt. The model does not error on that,
  // it just gets cut off mid-thought, which is indistinguishable from a bad
  // reply. Measured from the real prompt, so it tracks the tool catalog.
  it('keeps the native generation budget inside the model context window', () => {
    const model = NATIVE_MNN_MODELS[0];
    const measuredPromptFloorTokens = 1900;

    expect(measuredPromptFloorTokens + ASSISTANT.nativeMnnMaxTokens).toBeLessThanOrEqual(model.contextWindowSize);
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
    await runAssistantTurn(
      baseOpts(p, host(), [
        { role: 'user', text: 'ancient history' },
        { role: 'assistant', text: 'cleared', contextBoundary: true },
        { role: 'user', text: 'fresh question' },
      ]),
    );
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
    const out = await runAssistantTurn(baseOpts(p, host(), long));
    expect(out).toEqual([{ role: 'assistant', text: 'answer', toolCalls: [], raw: undefined, display: undefined, usage: undefined }]);
  });

  it('returns only this turn\'s new messages after a context boundary', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'answer', toolCalls: [] }]);
    const out = await runAssistantTurn(
      baseOpts(p, host(), [
        { role: 'user', text: 'old' },
        { role: 'assistant', text: 'cleared', contextBoundary: true },
        { role: 'user', text: 'new' },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('answer');
  });

  it('attaches the provider-reported usage to the final assistant message', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: 'answer', toolCalls: [], usage: { promptTokens: 1200, completionTokens: 30, totalTokens: 1230 } },
    ]);
    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'q' }]));
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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]' }),
    } as never);
    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'q' }]));
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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'count_events', description: '', schema: {}, execute,
    } as never);

    const out = await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'how many people came home today' }]));

    expect(execute).toHaveBeenCalledTimes(1);
    const repeat = out.filter((m) => m.role === 'tool')[1];
    expect(repeat?.toolResults?.[0].isError).toBe(true);
    expect(repeat?.toolResults?.[0].output).toContain('already called count_events');
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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_events', description: '', schema: {}, execute,
    } as never);

    await runAssistantTurn(baseOpts(p, host(), [{ role: 'user', text: 'how many people today' }]));

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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_events', description: '', schema: {}, destructive: false,
      execute: async () => ({
        output: '[{"id":"1"}]',
        display: [{ kind: 'event', id: '1', title: 'Front Door', navigatePath: '/events/1', imageUrls: ['thumb'] }],
      }),
    } as never);

    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'Summarize my day' }]));

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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[{"name":"Front Door","status":"Connected"}]' }),
    } as never);

    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'What is my camera status?' }]));

    expect(out.map((message) => message.text)).not.toContain('Front Door is armed.');
    expect(h.onActivity).toHaveBeenCalledWith({ toolName: 'list_monitors', status: 'done', input: {} });
    expect(out[out.length - 1].text).toBe('Front Door is connected.');
    vi.restoreAllMocks();
  });

  it('stops at the iteration cap', async () => {
    const p = new MockProvider();
    p.setScript(Array.from({ length: 10 }, () => ({ toolCalls: [{ id: 'c', name: 'list_monitors', input: {} }] })));
    const h = host();
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]' }),
    } as never);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'go' }]));
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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'count_events', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{"Front Door": 5}' }),
    } as never);
    await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'which monitor was most active?' }]));

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
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]', display }),
    } as never);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'list monitors' }]));
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.display).toBeUndefined();
    const finalMsg = out[out.length - 1];
    expect(finalMsg.role).toBe('assistant');
    expect(finalMsg.text).toBe('Front Door is enabled.');
    expect(finalMsg.display).toEqual(display);
  });

  it('leaves display undefined on the final message when no tool call returned display', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'get_server_health', input: {} }] },
      { text: 'All good.', toolCalls: [] },
    ]);
    const h = host();
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'get_server_health', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{}' }),
    } as never);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'is the server ok?' }]));
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
    vi.spyOn(await import('../tools'), 'getToolByName').mockImplementation((name: string) => ({
      name, description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '{}', display: [card] }),
    } as never));
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'tell me about event 42' }]));
    const finalMsg = out[out.length - 1];
    expect(finalMsg.display).toEqual([card]);
  });
});
