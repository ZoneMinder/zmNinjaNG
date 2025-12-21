import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAlarm,
  changeMonitorFunction,
  getAlarmStatus,
  getControl,
  getDaemonStatus,
  getMonitor,
  getMonitors,
  getStreamUrl,
  setMonitorEnabled,
  triggerAlarm,
  updateMonitor,
} from '../monitors';
import { getApiClient } from '../client';
import { validateApiResponse } from '../../lib/api-validator';
import { getMonitorStreamUrl } from '../../lib/url-builder';

const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

vi.mock('../../lib/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

vi.mock('../../lib/url-builder', () => ({
  getMonitorStreamUrl: vi.fn(() => 'https://stream.test'),
  getMonitorControlUrl: vi.fn(() => 'https://control.test'),
}));

vi.mock('../../lib/platform', () => ({
  Platform: {
    shouldUseProxy: false,
  },
}));

describe('Monitors API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
      put: mockPut,
    });
  });

  it('fetches monitors list', async () => {
    mockGet.mockResolvedValue({ data: { monitors: [{ Monitor: { Id: '1' } }] } });

    const response = await getMonitors();

    expect(mockGet).toHaveBeenCalledWith('/monitors.json');
    expect(response.monitors).toHaveLength(1);
  });

  it('fetches a monitor and validates response', async () => {
    mockGet.mockResolvedValue({ data: { monitor: { Id: '1', Name: 'Front Door' } } });

    const monitor = await getMonitor('1');

    expect(mockGet).toHaveBeenCalledWith('/monitors/1.json');
    expect(validateApiResponse).toHaveBeenCalled();
    expect(monitor.Id).toBe('1');
  });

  it('fetches control data for a monitor', async () => {
    mockGet.mockResolvedValue({ data: { control: { Control: { Id: '1' } } } });

    const control = await getControl('1');

    expect(mockGet).toHaveBeenCalledWith('/controls/1.json');
    expect(control.control.Control.Id).toBe('1');
  });

  it('updates monitor data', async () => {
    mockPut.mockResolvedValue({ data: { monitor: { Id: '2', Name: 'Updated' } } });

    const updated = await updateMonitor('2', { 'Monitor[Name]': 'Updated' });

    expect(mockPut).toHaveBeenCalledWith('/monitors/2.json', { 'Monitor[Name]': 'Updated' });
    expect(updated.Id).toBe('2');
  });

  it('changes monitor function', async () => {
    mockPut.mockResolvedValue({ data: { monitor: { Id: '3' } } });

    await changeMonitorFunction('3', 'Monitor');

    expect(mockPut).toHaveBeenCalledWith('/monitors/3.json', { 'Monitor[Function]': 'Monitor' });
  });

  it('enables or disables a monitor', async () => {
    mockPut.mockResolvedValue({ data: { monitor: { Id: '4' } } });

    await setMonitorEnabled('4', false);

    expect(mockPut).toHaveBeenCalledWith('/monitors/4.json', { 'Monitor[Enabled]': '0' });
  });

  it('triggers and cancels alarms', async () => {
    mockGet.mockResolvedValue({});

    await triggerAlarm('5');
    await cancelAlarm('5');

    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:5/command:on.json');
    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:5/command:off.json');
  });

  it('gets alarm status', async () => {
    mockGet.mockResolvedValue({ data: { status: 'on' } });

    const status = await getAlarmStatus('6');

    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:6/command:status.json');
    expect(status.status).toBe('on');
  });

  it('gets daemon status', async () => {
    mockGet.mockResolvedValue({ data: { status: 'running' } });

    const status = await getDaemonStatus('7', 'zmc');

    expect(mockGet).toHaveBeenCalledWith('/monitors/daemonStatus/id:7/daemon:zmc.json');
    expect(status.status).toBe('running');
  });

  it('builds monitor stream URL via url builder', () => {
    const url = getStreamUrl('https://example.test/cgi-bin', '9', {
      mode: 'stream',
      scale: 50,
    });

    expect(getMonitorStreamUrl).toHaveBeenCalledWith(
      'https://example.test/cgi-bin',
      '9',
      expect.objectContaining({ mode: 'stream', scale: 50 })
    );
    expect(url).toBe('https://stream.test');
  });
});
