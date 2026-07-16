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
});
