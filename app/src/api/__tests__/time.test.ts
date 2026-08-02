import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerTimeZone } from '../time';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockClient = { get: mockGet } as unknown as ApiClient;

vi.mock('../../lib/logger', () => ({
  log: {
    error: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

describe('Time API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches server time zone without token', async () => {
    mockGet.mockResolvedValue({
      data: {
        DateTime: {
          TimeZone: 'America/Chicago',
        },
      },
    });

    const timezone = await getServerTimeZone(mockClient);

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

    const timezone = await getServerTimeZone(mockClient, 'token-123');

    expect(mockGet).toHaveBeenCalledWith('/host/getTimeZone.json', { params: { token: 'token-123' } });
    expect(timezone).toBe('UTC');
  });
});
