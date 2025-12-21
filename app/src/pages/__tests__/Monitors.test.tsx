import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Monitors from '../Monitors';

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: (string | undefined)[] }) => useQueryMock(options),
}));

vi.mock('../../components/monitors/MonitorCard', () => ({
  MonitorCard: ({ monitor }: { monitor: { Id: string; Name: string } }) => (
    <div data-testid={`monitor-card-${monitor.Id}`}>{monitor.Name}</div>
  ),
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfile: () => { id: string; username?: string } | null }) => unknown) =>
    selector({
      currentProfile: () => ({ id: 'profile-1', username: 'admin' }),
    }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'monitors.count' && params?.count !== undefined) {
        return `count-${params.count}`;
      }
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

describe('Monitors Page', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it('shows empty state when no monitors are available', () => {
    useQueryMock.mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'monitors') {
        return {
          data: { monitors: [] },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: {}, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<Monitors />);

    expect(screen.getByTestId('monitors-empty-state')).toBeInTheDocument();
  });

  it('renders monitor cards when data is available', () => {
    useQueryMock.mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'monitors') {
        return {
          data: {
            monitors: [
              { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } },
              { Monitor: { Id: '2', Name: 'Back Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } },
            ],
          },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'consoleEvents') {
        return { data: { '1': 2, '2': 1 }, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: {}, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<Monitors />);

    expect(screen.getByTestId('monitor-grid')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Back Door');
  });
});
