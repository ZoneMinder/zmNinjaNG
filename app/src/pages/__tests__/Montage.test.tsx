import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Montage from '../Montage';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/montage' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      monitors: [
        {
          Monitor: {
            Id: '1',
            Name: 'Camera 1',
            Width: '1920',
            Height: '1080',
            Orientation: 'ROTATE_0',
            Enabled: '1',
            Function: 'Monitor',
          },
          Event_Count: '5',
        },
        {
          Monitor: {
            Id: '2',
            Name: 'Camera 2',
            Width: '1920',
            Height: '1080',
            Orientation: 'ROTATE_0',
            Enabled: '1',
            Function: 'Monitor',
          },
          Event_Count: '3',
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: vi.fn((selector) => {
    const state = {
      profiles: [
        {
          id: 'test-profile',
          name: 'Test Profile',
          cgiUrl: 'https://zm.test',
          apiUrl: 'https://zm.test/api',
        },
      ],
      currentProfileId: 'test-profile',
      currentProfile: () => ({
        id: 'test-profile',
        name: 'Test Profile',
        cgiUrl: 'https://zm.test',
        apiUrl: 'https://zm.test/api',
      }),
    };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: any) => {
    const state = {
      tokens: {
        'test-profile': { access_token: 'test-token' },
      },
      accessToken: 'test-token',
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = {
      getProfileSettings: () => ({
        viewMode: 'streaming',
        streamScale: 100,
        streamMaxFps: 10,
        snapshotRefreshInterval: 5,
        montageGridCols: 3,
        montageSortBy: 'name',
        montageSortOrder: 'asc',
        insomnia: false,
      }),
      updateProfileSettings: vi.fn(),
      saveMontageLayout: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

vi.mock('../../stores/monitors', () => ({
  useMonitorStore: (selector: any) => {
    const state = {
      regenerateConnKey: vi.fn(() => 12345),
    };
    return typeof selector === 'function' ? selector(state) : state.regenerateConnKey;
  },
}));

vi.mock('../../lib/logger', () => ({
  log: {
    montageMonitor: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('../../hooks/useInsomnia', () => ({
  useInsomnia: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock ResizeObserver
class ResizeObserverMock {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    // Simulate initial observation with a width
    setTimeout(() => {
      this.callback(
        [
          {
            target,
            contentRect: { width: 1200, height: 800 } as DOMRectReadOnly,
            borderBoxSize: [] as any,
            contentBoxSize: [] as any,
            devicePixelContentBoxSize: [] as any,
          },
        ],
        this
      );
    }, 0);
  }

  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as any;

describe('Montage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<Montage />);
    expect(container).toBeInTheDocument();
  });

  it('uses ResizeObserver to measure container width', async () => {
    const { container } = render(<Montage />);

    // Wait for ResizeObserver to fire and component to render
    await waitFor(() => {
      // The component should render some content
      expect(container.firstChild).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('renders monitor cards when monitors are available', async () => {
    render(<Montage />);

    // Wait for monitors to render
    await waitFor(() => {
      // Should show monitor names
      expect(screen.getByText('Camera 1')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('renders grid layout after width is measured', async () => {
    const { container } = render(<Montage />);

    await waitFor(() => {
      // Grid should be rendered
      const gridElement = container.querySelector('.react-grid-layout');
      expect(gridElement).toBeInTheDocument();
    }, { timeout: 2000 });
  });
});
