import { describe, it, expect, vi } from 'vitest';
import { runAssistantTurn, truncateHistory } from '../agent';
import { MockProvider } from '../providers/mock';
import type { AssistantHost, AssistantMessage } from '../types';
import { asProfileId } from '../../../api/types';

function host(confirmResult = true): AssistantHost {
  return { confirm: vi.fn().mockResolvedValue(confirmResult), navigate: vi.fn(), onActivity: vi.fn() };
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
});

describe('runAssistantTurn', () => {
  it('does not execute a destructive tool when confirm resolves false', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'set_monitor_enabled', input: { monitorId: '4', enabled: false } }] },
      { text: 'Okay, left it as is.', toolCalls: [] },
    ]);
    const h = host(false);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'disarm 4' }]));
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.toolResults?.[0].output).toBe('User declined this action.');
    expect(h.confirm).toHaveBeenCalledOnce();
  });

  it('reports an error result and never executes when buildConfirm rejects', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'delete_event', input: { eventId: '999' } }] },
      { text: 'Sorry, I could not confirm that.', toolCalls: [] },
    ]);
    const h = host();
    const execute = vi.fn().mockResolvedValue({ output: 'deleted' });
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'delete_event', description: '', schema: {}, destructive: true,
      buildConfirm: vi.fn().mockRejectedValue(new Error('event not found')),
      execute,
    } as never);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'delete event 999' }]));
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.toolResults?.[0].isError).toBe(true);
    expect(toolMsg?.toolResults?.[0].output).toContain('event not found');
    expect(execute).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
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
