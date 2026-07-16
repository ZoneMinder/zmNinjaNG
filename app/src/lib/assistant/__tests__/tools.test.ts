import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolByName, readOnlyTools, destructiveTools, TOOLS } from '../tools';
import type { ToolContext } from '../types';
import { asProfileId } from '../../../api/types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { getEvents, deleteEvent, setEventArchived } from '../../../api/events';
import { triggerAlarm, cancelAlarm, setMonitorEnabled, changeMonitorFunction } from '../../../api/monitors';
import { changeState } from '../../../api/states';

vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({
    monitors: [{ Monitor: { Id: '1', Name: 'Front Door', Function: 'Modect', Enabled: '1' } }],
  }),
  getMonitor: vi.fn().mockResolvedValue({
    Monitor: { Id: '1', Name: 'Front Door', Function: 'Modect', Enabled: '1' },
  }),
  getAlarmStatus: vi.fn().mockResolvedValue({ status: 0, output: 0 }),
  triggerAlarm: vi.fn().mockResolvedValue(undefined),
  cancelAlarm: vi.fn().mockResolvedValue(undefined),
  setMonitorEnabled: vi.fn().mockResolvedValue(undefined),
  changeMonitorFunction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../api/states', () => ({
  changeState: vi.fn().mockResolvedValue(undefined),
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
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  setEventArchived: vi.fn().mockResolvedValue(undefined),
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

  it('TOOLS includes readOnlyTools plus the destructive tools', () => {
    expect(TOOLS).toEqual([...readOnlyTools, ...destructiveTools]);
  });

  it('every read-only tool is non-destructive', () => {
    expect(readOnlyTools.every((t) => t.destructive === false)).toBe(true);
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
});

describe('destructive tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('trigger_alarm is destructive and builds a confirm request', async () => {
    const tool = getToolByName('trigger_alarm')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ monitorId: '1' }, ctx());
    expect(req.toolName).toBe('trigger_alarm');
    expect(req.messageKey).toBe('assistant.confirm.trigger_alarm');
    expect(req.messageParams).toMatchObject({ monitorId: '1' });
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(triggerAlarm).toHaveBeenCalledWith('1');
  });

  it('cancel_alarm is destructive and builds a confirm request', async () => {
    const tool = getToolByName('cancel_alarm')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ monitorId: '1' }, ctx());
    expect(req.messageKey).toBe('assistant.confirm.cancel_alarm');
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(cancelAlarm).toHaveBeenCalledWith('1');
  });

  it('set_monitor_enabled is destructive and builds a concrete confirm', async () => {
    const tool = getToolByName('set_monitor_enabled')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ monitorId: '4', enabled: false }, ctx());
    expect(req.toolName).toBe('set_monitor_enabled');
    expect(req.messageParams).toMatchObject({ id: '4', enabled: false });
    const r = await tool.execute({ monitorId: '4', enabled: false }, ctx());
    expect(r.isError).toBeFalsy();
    expect(setMonitorEnabled).toHaveBeenCalledWith('4', false);
  });

  it('change_monitor_function is destructive and builds a concrete confirm', async () => {
    const tool = getToolByName('change_monitor_function')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ monitorId: '2', func: 'Record' }, ctx());
    expect(req.messageParams).toMatchObject({ id: '2', func: 'Record' });
    const r = await tool.execute({ monitorId: '2', func: 'Record' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(changeMonitorFunction).toHaveBeenCalledWith('2', 'Record');
  });

  it('change_run_state is destructive and builds a concrete confirm', async () => {
    const tool = getToolByName('change_run_state')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ state: 'Away' }, ctx());
    expect(req.messageKey).toBe('assistant.confirm.change_run_state');
    expect(req.messageParams).toMatchObject({ state: 'Away' });
    const r = await tool.execute({ state: 'Away' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(changeState).toHaveBeenCalledWith('Away');
  });

  it('delete_event confirm fetches event detail for the card', async () => {
    const tool = getToolByName('delete_event')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ eventId: '99' }, ctx());
    expect(req.messageKey).toBe('assistant.confirm.delete_event');
    expect(req.messageParams).toMatchObject({ eventId: '99', monitorId: '1' });
    expect(req.params).toMatchObject({ eventId: '99' });
    const r = await tool.execute({ eventId: '99' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(deleteEvent).toHaveBeenCalledWith('99');
  });

  it('archive_event is destructive and builds a concrete confirm', async () => {
    const tool = getToolByName('archive_event')!;
    expect(tool.destructive).toBe(true);
    const req = await tool.buildConfirm!({ eventId: '99', archived: true }, ctx());
    expect(req.messageKey).toBe('assistant.confirm.archive_event');
    expect(req.messageParams).toMatchObject({ eventId: '99', archived: true });
    const r = await tool.execute({ eventId: '99', archived: true }, ctx());
    expect(r.isError).toBeFalsy();
    expect(setEventArchived).toHaveBeenCalledWith('99', true);
  });
});
