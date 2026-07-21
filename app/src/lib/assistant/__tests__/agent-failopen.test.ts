/**
 * The fail-open gate (refs #265): a turn routed with NO tools (triage said
 * chat/action) whose model calls a real registry read tool flips to the full
 * registry and runs the call, instead of refusing it. The model's own attempt
 * is better routing evidence than the classifier: "summarize last week" was
 * triaged CHAT, the model called list_events anyway, and the refusal turned a
 * correct instinct into an apology. Separate file because executing the REAL
 * registry tool needs the full api mock set (mirroring tools.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { runAssistantTurn } from '../agent';
import { MockProvider } from '../providers/mock';
import type { AssistantHost } from '../types';
import { asProfileId } from '../../../api/types';
import { getEvents } from '../../../api/events';

vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({ monitors: [{ Monitor: { Id: '1', Name: 'Front Door' } }] }),
  getMonitor: vi.fn(),
  getAlarmStatus: vi.fn(),
}));
vi.mock('../../../api/events', () => ({
  getEvents: vi.fn().mockResolvedValue({
    events: [],
    pagination: { page: 1, pageCount: 1, current: 1, count: 0, prevPage: false, nextPage: false, limit: 25, totalCount: 0 },
  }),
  getEvent: vi.fn(),
  getConsoleEvents: vi.fn(),
  getEventImageUrl: vi.fn(() => ''),
}));
vi.mock('../../../api/server', () => ({
  getLoad: vi.fn(),
  getDiskPercent: vi.fn(),
  getDaemonCheck: vi.fn(),
  getStorages: vi.fn(),
  getServers: vi.fn(),
}));
vi.mock('../../../api/auth', () => ({ getVersion: vi.fn() }));
vi.mock('../../../api/groups', () => ({ getGroups: vi.fn() }));
vi.mock('../../../api/tags', () => ({ getTags: vi.fn(), getEventTags: vi.fn(), extractUniqueTags: vi.fn() }));

const host: AssistantHost = { navigate: vi.fn(), onActivity: vi.fn() };

describe('fail-open tool routing', () => {
  it('runs a registry read tool the model calls on a tool-less turn', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'list_events', input: { when: 'last week' } }] },
      { text: 'No events in the last week.', toolCalls: [] },
    ]);

    const out = await runAssistantTurn({
      provider: p,
      host,
      ctx: {
        profileId: asProfileId('p1'),
        queryClient: {} as never,
        host,
        interpretWhen: async () => ({ lastCount: 1, lastUnit: 'week' }),
      },
      history: [{ role: 'user', text: 'summarize last week' }],
      system: 'sys',
      signal: new AbortController().signal,
      tools: [],
    });

    // The call executed (the query went out) instead of being refused.
    expect(vi.mocked(getEvents)).toHaveBeenCalledWith(
      expect.objectContaining({ startDateTime: expect.any(String), endDateTime: expect.any(String) }),
    );
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.toolResults?.[0]?.output).not.toContain('No tools are available');
    expect(out[out.length - 1].text).toBe('No events in the last week.');
  });

  it('still refuses a withheld action on a tool-less turn', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'trigger_alarm', input: { monitorId: '1' } }] },
      { text: 'I cannot trigger alarms.', toolCalls: [] },
    ]);

    const out = await runAssistantTurn({
      provider: p,
      host,
      ctx: { profileId: asProfileId('p1'), queryClient: {} as never, host },
      history: [{ role: 'user', text: 'trigger the alarm' }],
      system: 'sys',
      signal: new AbortController().signal,
      tools: [],
    });

    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.toolResults?.[0]?.isError).toBe(true);
    expect(toolMsg?.toolResults?.[0]?.output).toContain('not something this assistant can do');
  });
});
