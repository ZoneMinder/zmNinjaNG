import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getToolByName, readOnlyTools, destructiveTools, TOOLS } from '../tools';
import type { ToolContext } from '../types';
import { asProfileId } from '../../../api/types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { getEvents, deleteEvent, setEventArchived } from '../../../api/events';
import { getMonitor, getMonitors, triggerAlarm, cancelAlarm, setMonitorEnabled, changeMonitorFunction } from '../../../api/monitors';
import { changeState } from '../../../api/states';
import { getStorages, getServers } from '../../../api/server';
import { DEFAULT_THUMBNAIL_FALLBACK_CHAIN } from '../../../stores/settings';

const { mockMonitor, mockMonitorStatus } = vi.hoisted(() => ({
  mockMonitor: {
    Id: '1', Name: 'Front Door', Type: 'Local', Function: 'Modect', Enabled: '1',
    Controllable: '1', ControlId: '3', Width: '1920', Height: '1080',
  },
  mockMonitorStatus: { Status: 'Connected', CaptureFPS: '5.0', AnalysisFPS: '2.0' },
}));

vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({
    monitors: [{ Monitor: mockMonitor, Monitor_Status: mockMonitorStatus }],
  }),
  getMonitor: vi.fn().mockResolvedValue({
    Monitor: mockMonitor, Monitor_Status: mockMonitorStatus,
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
      {
        Event: {
          Id: '42', MonitorId: '1', Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00',
          EndDateTime: '2026-01-01 00:01:00', Length: '12.5', Frames: '30', AlarmFrames: '5',
          MaxScore: '10', AvgScore: '4', TotScore: '120', Archived: '0',
          Notes: 'detected:person,car|Motion: All',
        },
      },
    ],
    // pagination.nextPage = false: exactly one match, nothing beyond this
    // page, so list_events' `truncated` flag stays unset by default (refs #246).
    pagination: { page: 1, pageCount: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 25, totalCount: 1 },
  }),
  getEvent: vi.fn().mockResolvedValue({
    Event: {
      Id: '42', MonitorId: '1', Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00',
      EndDateTime: '2026-01-01 00:01:00', Length: '12.5', Frames: '30', AlarmFrames: '5',
      MaxScore: '10', AvgScore: '4', TotScore: '120', Archived: '0', DefaultVideo: 'video.mp4',
      Notes: 'detected:person,car|Motion: All',
    },
  }),
  getConsoleEvents: vi.fn().mockResolvedValue([{ monitorId: '1', count: 3 }]),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  setEventArchived: vi.fn().mockResolvedValue(undefined),
  // Used by lib/event/thumbnail-chain.ts's buildThumbnailChain (refs #246) when
  // a tool builds event display cards; the real impl just concatenates a URL.
  getEventImageUrl: vi.fn(
    (portalUrl: string, eventId: string, frame: string) => `${portalUrl}/index.php?view=image&eid=${eventId}&fid=${frame}`,
  ),
}));

vi.mock('../../../api/server', () => ({
  getLoad: vi.fn().mockResolvedValue({ load: 0.5 }),
  getDiskPercent: vi.fn().mockResolvedValue({ percent: 42 }),
  getDaemonCheck: vi.fn().mockResolvedValue(true),
  getStorages: vi.fn().mockResolvedValue([
    { Id: '1', Name: 'Default', DiskUsedSpace: 50, DiskTotalSpace: 100, DiskSpace: null },
  ]),
  getServers: vi.fn().mockResolvedValue([{ Id: '1', Name: 'zm1' }]),
}));

vi.mock('../../../api/auth', () => ({
  getVersion: vi.fn().mockResolvedValue({ version: '1.37.0', apiversion: '2.0' }),
}));

vi.mock('../../../api/groups', () => ({
  getGroups: vi.fn().mockResolvedValue({
    groups: [
      { Group: { Id: '1', Name: 'Outside' }, Monitor: [{ Id: '1', Name: 'Front Door' }] },
      { Group: { Id: '2', Name: 'Empty Group' }, Monitor: [] },
    ],
  }),
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

// Adds the image-building inputs AskPanel.tsx supplies in production (refs #246),
// so list_events/get_event/list_monitors/get_monitor can be asserted to build
// `display` result cards the same way MonitorRecentEvents.tsx builds thumbnails.
function ctxWithDisplay(): ToolContext {
  return {
    ...ctx(),
    portalUrl: 'https://zm.example.com',
    accessToken: 'tok123',
    minStreamingPort: undefined,
    thumbnailFallbackChain: DEFAULT_THUMBNAIL_FALLBACK_CHAIN,
    dateTimeFormat: { dateFormat: 'MMM d, yyyy', timeFormat: '24h', customDateFormat: '', customTimeFormat: '' },
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

  it('list_monitors includes controllable, status, and live fps', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const rows = JSON.parse(r.output as string);
    expect(rows[0]).toMatchObject({
      id: '1', name: 'Front Door', type: 'Local', enabled: true, controllable: true,
      controlId: '3', width: 1920, height: 1080, status: 'Connected', captureFps: 5, analysisFps: 2,
    });
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

  // Same model habit as list_events, less dangerous outcome: getMonitor("Front
  // Door") fails at the API rather than returning an empty set, so it never
  // became a false "no". It still fails a question it could have answered.
  describe('get_monitor monitor resolution', () => {
    it('resolves a monitor NAME to its id', async () => {
      const tool = getToolByName('get_monitor')!;
      const r = await tool.execute({ monitorId: 'Front Door' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getMonitor)).toHaveBeenCalledWith('1');
    });

    it('passes a numeric id straight through without listing monitors first', async () => {
      const tool = getToolByName('get_monitor')!;
      const r = await tool.execute({ monitorId: '1' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getMonitor)).toHaveBeenCalledWith('1');
      // A bare id needs no lookup: a wrong one fails loudly at the API, which
      // is why this path can stay one request instead of two.
      expect(vi.mocked(getMonitors)).not.toHaveBeenCalled();
    });

    it('errors with the real monitor names for an unknown name', async () => {
      const tool = getToolByName('get_monitor')!;
      const r = await tool.execute({ monitorId: 'Nonexistent Cam' }, ctx());
      expect(r.isError).toBe(true);
      expect(r.output).toContain('Front Door');
      expect(vi.mocked(getMonitor)).not.toHaveBeenCalled();
    });
  });

  // A small model reliably passes the monitor NAME it saw in a previous
  // list_events/list_monitors row, not the numeric id. ZoneMinder's
  // `MonitorId:FrontDoor` filter matches nothing, so the query came back with
  // total: 0 and the model answered "no one came to your front door" about a
  // camera it had never actually queried. A false negative is the worst
  // possible failure for this app, so a name must resolve, and anything
  // unresolvable must be an error the model can see and retry, never an empty
  // result set that reads like an answer.
  describe('list_events monitor resolution', () => {
    it('resolves a monitor NAME to its id', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: 'Front Door' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ monitorId: '1' }));
    });

    it('resolves a name ignoring case and surrounding space', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: '  front door ' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ monitorId: '1' }));
    });

    // "FrontDoor" is exactly what the model sent in the real failure.
    it('resolves a name with the spaces stripped out', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: 'FrontDoor' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ monitorId: '1' }));
    });

    it('passes a valid numeric id straight through', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: '1' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ monitorId: '1' }));
    });

    it('errors, and never queries, for a monitor that does not exist', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: 'Back Garden' }, ctx());
      expect(r.isError).toBe(true);
      // Naming the real monitors gives the model what it needs to retry.
      expect(r.output).toContain('Front Door');
      expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
    });

    it('errors for an id that looks numeric but matches no monitor', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: '999' }, ctx());
      expect(r.isError).toBe(true);
      expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
    });

    it('queries every monitor when none is given', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({}, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ monitorId: undefined }));
    });

    // Small models emit the literal string "null" (or "undefined"/"none"/"all")
    // for an optional arg they mean to omit. Treating that as a monitor NAME
    // threw "no monitor named null" and the model then hallucinated an answer
    // from the error. These mean "no filter", not a real monitor.
    it.each(['null', 'undefined', 'none', 'None', 'all', 'NULL', ''])(
      'treats %o as "all monitors", not a failed lookup',
      async (placeholder) => {
        const tool = getToolByName('list_events')!;
        const r = await tool.execute({ monitorId: placeholder, range: 'today' }, ctx());
        expect(r.isError).toBeFalsy();
        expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ monitorId: undefined }));
      },
    );

    it('ignores a placeholder objectType instead of matching nothing', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ objectType: 'null' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.objectContaining({ notesRegexp: undefined }));
    });
  });

  // `resolveEventRange` switches over the EventRange union with no default:
  // TypeScript proves that exhaustive, but the model is not a typechecker. It
  // sent "last week", the switch fell through returning undefined, and the
  // date filter silently vanished, so an unscoped query answered a question
  // about last week.
  describe('list_events range validation', () => {
    it('errors on a range outside the enum instead of dropping the date filter', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ range: 'last week' }, ctx());
      expect(r.isError).toBe(true);
      // The valid values, so the model can retry with one.
      expect(r.output).toContain('last_7d');
      expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
    });

    it('applies a date filter for a valid range', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ range: 'yesterday' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(
        expect.objectContaining({
          startDateTime: expect.any(String),
          endDateTime: expect.any(String),
        }),
      );
    });
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

  it('list_events rows carry the monitor NAME and detected objects, not a bare id', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const { events: rows } = JSON.parse(r.output as string);
    expect(rows[0]).toMatchObject({ id: '42', monitor: 'Front Door', objects: ['person', 'car'] });
  });

  it('list_events rows include duration/scores/archived and a notes preview', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const { events: rows } = JSON.parse(r.output as string);
    expect(rows[0]).toMatchObject({
      durationSec: 12.5, frames: 30, alarmFrames: 5, maxScore: 10, avgScore: 4, archived: false,
      end: '2026-01-01 00:01:00', notes: 'detected:person,car|Motion: All',
    });
  });

  it('list_events builds an event display card with imageUrls, capped to the same rows as output (refs #246)', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    const { events: rows } = JSON.parse(r.output as string);
    expect(r.display).toHaveLength(rows.length);
    expect(r.display![0]).toMatchObject({ kind: 'event', id: '42', navigatePath: '/events/42' });
    expect(r.display![0].imageUrls!.length).toBeGreaterThan(0);
    expect(r.display![0].imageUrls![0]).toContain('http');
    // The model-facing output string must never carry image URLs (vision non-goal).
    expect(r.output).not.toContain('http');
  });

  it('list_monitors builds a monitor display card with no imageUrls (refs #246)', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    expect(r.display).toHaveLength(1);
    expect(r.display![0]).toMatchObject({ kind: 'monitor', id: '1', navigatePath: '/monitors/1' });
    expect(r.display![0].imageUrls).toBeUndefined();
    expect(r.output).not.toContain('http');
  });

  it('get_monitor builds a monitor display card with no imageUrls (refs #246)', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    expect(r.display).toHaveLength(1);
    expect(r.display![0]).toMatchObject({ kind: 'monitor', id: '1', navigatePath: '/monitors/1' });
    expect(r.display![0].imageUrls).toBeUndefined();
    expect(r.output).not.toContain('http');
  });

  it('get_monitor merges monitor detail with alarm status', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
    expect(r.output).toContain('alarm');
  });

  it('get_monitor includes control capability alongside alarm status', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    const detail = JSON.parse(r.output as string);
    expect(detail).toMatchObject({
      controllable: true, controlId: '3', status: 'Connected',
      alarm: { status: 0, output: 0 },
    });
  });

  it('count_events maps monitor ids to names', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute({ interval: '1 hour' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
    expect(r.output).toContain('3');
  });

  it('count_events reports the summed total across monitors', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute({ interval: '1 hour' }, ctx());
    expect(r.isError).toBeFalsy();
    const result = JSON.parse(r.output as string);
    expect(result).toMatchObject({
      interval: '1 hour', total: 3, monitors: [{ monitor: 'Front Door', count: 3 }],
    });
  });

  it('get_event returns duration/frames/score/notes', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('12.5');
    expect(r.output).toContain('detected:person');
  });

  it('get_event includes the monitor NAME and detected objects', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    const detail = JSON.parse(r.output as string);
    expect(detail).toMatchObject({ monitor: 'Front Door', objects: ['person', 'car'] });
  });

  it('get_event includes durationSec, totScore, tags, archived, and hasVideo', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    const detail = JSON.parse(r.output as string);
    expect(detail).toMatchObject({
      monitorId: '1', durationSec: 12.5, alarmFrames: 5, totScore: 120, archived: false,
      hasVideo: true, tags: [],
    });
  });

  it('get_event builds an event display card with imageUrls (refs #246)', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    expect(r.display).toHaveLength(1);
    expect(r.display![0]).toMatchObject({ kind: 'event', id: '42', navigatePath: '/events/42' });
    expect(r.display![0].imageUrls!.length).toBeGreaterThan(0);
    // The model-facing output string must never carry image URLs (vision non-goal).
    expect(r.output).not.toContain('http');
  });

  it('get_server_health aggregates load/disk/daemon/version', async () => {
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('1.37.0');
    expect(r.output).toContain('42');
  });

  it('get_server_health includes per-storage usage and server count when both succeed', async () => {
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const health = JSON.parse(r.output as string);
    expect(health).toMatchObject({
      storages: [{ name: 'Default', diskPercent: 50 }],
      serverCount: 1,
    });
  });

  it('get_server_health omits storages when getStorages rejects', async () => {
    vi.mocked(getStorages).mockRejectedValueOnce(new Error('storage.json not found'));
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const health = JSON.parse(r.output as string);
    expect(health.storages).toBeUndefined();
    expect(health.daemonRunning).toBe(true);
  });

  it('get_server_health omits serverCount when getServers rejects', async () => {
    vi.mocked(getServers).mockRejectedValueOnce(new Error('servers.json not found'));
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const health = JSON.parse(r.output as string);
    expect(health.serverCount).toBeUndefined();
    expect(health.storages).toMatchObject([{ name: 'Default', diskPercent: 50 }]);
  });

  it('list_groups returns id/name', async () => {
    const tool = getToolByName('list_groups')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Outside');
  });

  it('list_groups includes member monitor ids when the group carries them', async () => {
    const tool = getToolByName('list_groups')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const groups = JSON.parse(r.output as string);
    expect(groups[0]).toMatchObject({ id: '1', name: 'Outside', monitorIds: ['1'] });
    expect(groups[1]).toMatchObject({ id: '2', name: 'Empty Group' });
    expect(groups[1].monitorIds).toBeUndefined();
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

describe('list_events range resolution (refs #246)', () => {
  // Fixes the clock so `resolveEventRange`'s `new Date()` call inside the
  // executor is deterministic; matches event-range.test.ts's own NOW so the
  // expected wall-clock strings line up with that file's documented math.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T14:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves range against ctx.timezone into startDateTime/endDateTime filters', async () => {
    const tool = getToolByName('list_events')!;
    await tool.execute({ range: 'today' }, { ...ctx(), timezone: 'America/New_York' });
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' }),
    );
  });

  it('falls back to the browser timezone when ctx.timezone is unset', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ range: 'last_hour' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startDateTime: expect.any(String), endDateTime: expect.any(String) }),
    );
  });

  it('an explicit startTime/endTime overrides range', async () => {
    const tool = getToolByName('list_events')!;
    await tool.execute(
      { range: 'today', startTime: '2020-01-01 00:00:00', endTime: '2020-01-02 00:00:00' },
      { ...ctx(), timezone: 'America/New_York' },
    );
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startDateTime: '2020-01-01 00:00:00', endDateTime: '2020-01-02 00:00:00' }),
    );
  });

  it('combines range with objectType into a notesRegexp filter, for "how many people today" style questions', async () => {
    const tool = getToolByName('list_events')!;
    await tool.execute({ range: 'today', objectType: 'person' }, { ...ctx(), timezone: 'America/New_York' });
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startDateTime: '2026-07-16 00:00:00', notesRegexp: 'detected:.*person' }),
    );
  });

  it('flags truncated when more matches exist beyond the capped page', async () => {
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          Event: {
            Id: '42', MonitorId: '1', StorageId: null, SecondaryStorageId: null, Name: 'Event 42',
            Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00', EndDateTime: '2026-01-01 00:01:00',
            Width: '1920', Height: '1080', Length: '12.5', Frames: '30', AlarmFrames: '5',
            DefaultVideo: null, SaveJPEGs: null, MaxScore: '10', AvgScore: '4', TotScore: '120',
            Archived: '0', Videoed: '0', Uploaded: '0', Emailed: '0', Messaged: '0', Executed: '0',
            Notes: 'detected:person,car|Motion: All', StateId: null, Orientation: null,
            DiskSpace: null, Scheme: null,
          },
        },
      ],
      pagination: { page: 1, pageCount: 2, current: 1, count: 1, prevPage: false, nextPage: true, limit: 1, totalCount: 2 },
    });
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(r.output as string);
    expect(parsed.truncated).toBe(true);
    expect(parsed.events).toHaveLength(1);
  });

  it('leaves truncated unset when every match fits on the page', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    const parsed = JSON.parse(r.output as string);
    expect(parsed.truncated).toBeUndefined();
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

    const disableReq = await tool.buildConfirm!({ monitorId: '4', enabled: false }, ctx());
    expect(disableReq.toolName).toBe('set_monitor_enabled');
    expect(disableReq.messageKey).toBe('assistant.confirm.set_monitor_enabled_disable');
    expect(disableReq.messageParams).toMatchObject({ id: '4' });
    expect(disableReq.messageParams).not.toHaveProperty('enabled');

    const enableReq = await tool.buildConfirm!({ monitorId: '4', enabled: true }, ctx());
    expect(enableReq.messageKey).toBe('assistant.confirm.set_monitor_enabled_enable');
    expect(enableReq.messageParams).toMatchObject({ id: '4' });

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

    const archiveReq = await tool.buildConfirm!({ eventId: '99', archived: true }, ctx());
    expect(archiveReq.messageKey).toBe('assistant.confirm.archive_event_archive');
    expect(archiveReq.messageParams).toMatchObject({ eventId: '99' });
    expect(archiveReq.messageParams).not.toHaveProperty('archived');

    const unarchiveReq = await tool.buildConfirm!({ eventId: '99', archived: false }, ctx());
    expect(unarchiveReq.messageKey).toBe('assistant.confirm.archive_event_unarchive');
    expect(unarchiveReq.messageParams).toMatchObject({ eventId: '99' });

    const r = await tool.execute({ eventId: '99', archived: true }, ctx());
    expect(r.isError).toBeFalsy();
    expect(setEventArchived).toHaveBeenCalledWith('99', true);
  });
});
