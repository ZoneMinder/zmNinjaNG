import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerTimeZone } from '../time';
import { getApiClient } from '../client';

const mockGet = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    error: vi.fn(),
  },
}));

describe('Time API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
    });
  });

  it('fetches server time zone without token', async () => {
    mockGet.mockResolvedValue({
      data: {
        DateTime: {
          TimeZone: 'America/Chicago',
        },
      },
    });

    const timezone = await getServerTimeZone();

    expect(mockGet).toHaveBeenCalledWith('/host/getTimeZone.json', {});
    expect(timezone).toBe('America/Chicago');
  });

  it('fetches server time zone with token', async () => {
    mockGet.mockResolvedValue({
      data: {
        DateTime: {
          TimeZone: 'UTC',
        },
      },
    });

    const timezone = await getServerTimeZone('token-123');

    expect(mockGet).toHaveBeenCalledWith('/host/getTimeZone.json', { params: { token: 'token-123' } });
    expect(timezone).toBe('UTC');
  });
});
