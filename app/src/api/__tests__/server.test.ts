import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDaemonCheck, getDiskPercent, getLoad, getServers } from '../server';
import { getApiClient } from '../client';
import { validateApiResponse } from '../../lib/api-validator';

const mockGet = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

vi.mock('../../lib/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

describe('Server API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
    });
  });

  it('returns server list', async () => {
    mockGet.mockResolvedValue({
      data: {
        servers: [{ Id: '1', Name: 'Main' }],
      },
    });

    const servers = await getServers();

    expect(mockGet).toHaveBeenCalledWith('/servers.json');
    expect(validateApiResponse).toHaveBeenCalled();
    expect(servers).toEqual([{ Id: '1', Name: 'Main' }]);
  });

  it('checks daemon state', async () => {
    mockGet.mockResolvedValue({
      data: { result: 1 },
    });

    const isRunning = await getDaemonCheck();

    expect(mockGet).toHaveBeenCalledWith('/host/daemonCheck.json');
    expect(isRunning).toBe(true);
  });

  it('normalizes load value', async () => {
    mockGet.mockResolvedValue({
      data: { load: [1.2, 0.8, 0.5] },
    });

    const load = await getLoad();

    expect(mockGet).toHaveBeenCalledWith('/host/getLoad.json');
    expect(load.load).toBe(1.2);
  });

  it('parses disk usage from complex response', async () => {
    mockGet.mockResolvedValue({
      data: {
        usage: {
          Total: { space: 75.5 },
        },
        percent: 80,
      },
    });

    const disk = await getDiskPercent();

    expect(mockGet).toHaveBeenCalledWith('/host/getDiskPercent.json');
    expect(disk.usage).toBe(75.5);
    expect(disk.percent).toBe(80);
  });
});
