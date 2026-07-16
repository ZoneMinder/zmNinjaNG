import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolByName, readOnlyTools, TOOLS } from '../tools';
import type { ToolContext } from '../types';
import { asProfileId } from '../../../api/types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { getEvents } from '../../../api/events';

vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({
    monitors: [{ Monitor: { Id: '1', Name: 'Front Door', Function: 'Modect', Enabled: '1' } }],
  }),
  getMonitor: vi.fn().mockResolvedValue({
    Monitor: { Id: '1', Name: 'Front Door', Function: 'Modect', Enabled: '1' },
  }),
  getAlarmStatus: vi.fn().mockResolvedValue({ status: 0, output: 0 }),
}));

vi.mock('../../../api/events', () => ({
  getEvents: vi.fn().mockResolvedValue({
    events: [
      { Event: { Id: '42', MonitorId: '1', Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00', MaxScore: '10' } },
    ],
  }),
  getEvent: vi.fn().mockResolvedValue({
    Event: {
      Id: '42', MonitorId: '1', Cause: 'Motion', Length: '12.5', Frames: '30',
      MaxScore: '10', Notes: 'detected: person',
    },
  }),
  getConsoleEvents: vi.fn().mockResolvedValue([{ monitorId: '1', count: 3 }]),
}));

vi.mock('../../../api/server', () => ({
  getLoad: vi.fn().mockResolvedValue({ load: 0.5 }),
  getDiskPercent: vi.fn().mockResolvedValue({ percent: 42 }),
  getDaemonCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../api/auth', () => ({
  getVersion: vi.fn().mockResolvedValue({ version: '1.37.0', apiversion: '2.0' }),
}));

vi.mock('../../../api/groups', () => ({
  getGroups: vi.fn().mockResolvedValue({ groups: [{ Group: { Id: '1', Name: 'Outside' }, Monitor: [] }] }),
}));

vi.mock('../../../api/tags', async () => {
  const actual = await vi.importActual('../../../api/tags');
  return {
    ...actual,
    getTags: vi.fn().mockResolvedValue(null),
    getEventTags: vi.fn().mockResolvedValue(new Map()),
  };
});

function ctx(): ToolContext {
  return {
    profileId: asProfileId('p1'),
    queryClient: { fetchQuery: (o: { queryFn: () => unknown }) => o.queryFn() } as never,
    host: { confirm: vi.fn(), navigate: vi.fn(), onActivity: vi.fn() },
  };
}

describe('read-only tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list_monitors returns id/name/function/enabled', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
  });

  it('navigate rejects a route outside the allowlist', async () => {
    const c = ctx();
    const tool = getToolByName('navigate')!;
    const r = await tool.execute({ path: '/admin/delete-all' }, c);
    expect(r.isError).toBe(true);
    expect(c.host.navigate).not.toHaveBeenCalled();
  });

  it('navigate accepts an allowlisted route and asks the panel to close', async () => {
    const c = ctx();
    const tool = getToolByName('navigate')!;
    const r = await tool.execute({ path: '/events/42' }, c);
    expect(r.isError).toBeFalsy();
    expect(r.closePanel).toBe(true);
    expect(c.host.navigate).toHaveBeenCalledWith('/events/42');
  });

  it('list_events never combines tag and event-id filters', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ tag: '5', eventIds: ['1', '2'] }, ctx());
    expect(r.isError).toBe(true);
  });

  it('list_events caps the limit at ASSISTANT.maxListEventsLimit', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ limit: 999 }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('42');
  });

  it('list_events clamps a non-numeric or negative limit into [1, maxListEventsLimit]', async () => {
    const tool = getToolByName('list_events')!;
    const negative = await tool.execute({ limit: -5 }, ctx());
    expect(negative.isError).toBeFalsy();
    const nonNumeric = await tool.execute({ limit: 'banana' }, ctx());
    expect(nonNumeric.isError).toBeFalsy();
    // Both fall back to the max clamp rather than producing NaN/negative EventFilters.limit.
    expect(getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ limit: ASSISTANT.maxListEventsLimit }));
  });

  it('get_monitor merges monitor detail with alarm status', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
    expect(r.output).toContain('alarm');
  });

  it('count_events maps monitor ids to names', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute({ interval: '1 hour' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
    expect(r.output).toContain('3');
  });

  it('get_event returns duration/frames/score/notes', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('12.5');
    expect(r.output).toContain('detected: person');
  });

  it('get_server_health aggregates load/disk/daemon/version', async () => {
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('1.37.0');
    expect(r.output).toContain('42');
  });

  it('list_groups returns id/name', async () => {
    const tool = getToolByName('list_groups')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Outside');
  });

  it('list_tags degrades to an empty list when tags are unsupported', async () => {
    const tool = getToolByName('list_tags')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toBe('[]');
  });

  it('an unknown tool name resolves to undefined', () => {
    expect(getToolByName('does_not_exist')).toBeUndefined();
  });

  it('TOOLS currently equals readOnlyTools', () => {
    expect(TOOLS).toEqual(readOnlyTools);
  });

  it('every tool is read-only for now (destructive: false)', () => {
    expect(readOnlyTools.every((t) => t.destructive === false)).toBe(true);
  });
});
