import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useGroups } from '../useGroups';
import { getGroups } from '../../api/groups';
import type { GroupData } from '../../api/types';
import { ALL_PROFILES_ID } from '../../api/types';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// Mock dependencies
// getGroups is the api/* system boundary; kept as a function mock since the
// real endpoint response shape is exercised elsewhere. Permissions run for
// real: a profile with no username (the default fixture) short-circuits
// fetchAccountPermissions to UNRESTRICTED_PERMISSIONS with no network call,
// so canViewGroups() never denies here (groups permissions themselves are
// covered in the permission model tests, refs #344).
vi.mock('../../api/groups', () => ({
  getGroups: vi.fn(),
}));

const mockGroups: GroupData[] = [
  {
    Group: { Id: '1', Name: 'Inside', ParentId: null },
    Monitor: [{ Id: '1', Name: 'Living Room' }, { Id: '2', Name: 'Kitchen' }],
  },
  {
    Group: { Id: '2', Name: 'Outside', ParentId: null },
    Monitor: [{ Id: '3', Name: 'Driveway' }],
  },
  {
    Group: { Id: '3', Name: 'Downstairs', ParentId: '1' },
    Monitor: [{ Id: '4', Name: 'Basement' }],
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles(['profile-1'], { current: 'profile-1' });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fetches groups successfully', async () => {
    vi.mocked(getGroups).mockResolvedValue({ groups: mockGroups });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.groups).toHaveLength(3);
    expect(result.current.hasGroups).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns empty groups when none exist', async () => {
    vi.mocked(getGroups).mockResolvedValue({ groups: [] });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.groups).toHaveLength(0);
    expect(result.current.hasGroups).toBe(false);
  });

  it('handles fetch error', async () => {
    vi.mocked(getGroups).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('getGroupMonitorIds returns monitors for a group', async () => {
    vi.mocked(getGroups).mockResolvedValue({ groups: mockGroups });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Inside group has monitors 1, 2, plus child group (Downstairs) with monitor 4
    const insideMonitors = result.current.getGroupMonitorIds('1');
    expect(insideMonitors).toContain('1');
    expect(insideMonitors).toContain('2');
    expect(insideMonitors).toContain('4'); // From child group
    expect(insideMonitors).toHaveLength(3);
  });

  it('getGroupMonitorIds returns only direct monitors for leaf group', async () => {
    vi.mocked(getGroups).mockResolvedValue({ groups: mockGroups });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Downstairs has no children, just monitor 4
    const downstairsMonitors = result.current.getGroupMonitorIds('3');
    expect(downstairsMonitors).toEqual(['4']);
  });

  it('getGroupMonitorIds returns empty array for non-existent group', async () => {
    vi.mocked(getGroups).mockResolvedValue({ groups: mockGroups });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const nonExistent = result.current.getGroupMonitorIds('999');
    expect(nonExistent).toEqual([]);
  });

  it('does not fetch when no profile is selected', async () => {
    seedProfiles([], { current: null });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    // Should not trigger fetch
    expect(getGroups).not.toHaveBeenCalled();
    expect(result.current.groups).toEqual([]);
  });

  // The mechanism behind the command palette omitting group entries in All
  // Servers mode (refs #337, audit C13). Groups are per-server and nothing
  // aggregates them, so this hook stays silent while the ALL sentinel is
  // current: no request (its queryFn resolves getCurrentSession(), which has
  // no session for the sentinel) and an empty list, which is what leaves the
  // palette with no group rows to render rather than dead ones. The
  // sentinel-to-null mapping itself is useCurrentProfile's documented
  // behavior, covered in its own suite.
  it('stays silent in All Servers mode, which is why the palette lists no groups', async () => {
    seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });

    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    expect(getGroups).not.toHaveBeenCalled();
    expect(result.current.groups).toEqual([]);
    expect(result.current.hasGroups).toBe(false);
    expect(result.current.getGroupMonitorIds('1')).toEqual([]);
  });
});
