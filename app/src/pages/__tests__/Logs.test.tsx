import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Logs from '../Logs';

const clearLogs = vi.fn();
const logs = [
  {
    id: 'log-1',
    timestamp: '2024-01-01T00:00:00Z',
    level: 'INFO',
    message: 'Auth log',
    context: { component: 'Auth' },
  },
  {
    id: 'log-2',
    timestamp: '2024-01-01T00:00:01Z',
    level: 'WARN',
    message: 'API log',
    context: { component: 'API' },
  },
  {
    id: 'log-3',
    timestamp: '2024-01-01T00:00:02Z',
    level: 'ERROR',
    message: 'Unassigned log',
  },
];

vi.mock('../../stores/logs', () => ({
  useLogStore: (selector: (state: { logs: any[]; clearLogs: typeof clearLogs }) => unknown) =>
    selector({
      logs,
      clearLogs,
    }),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    getLevel: () => 1,
    setLevel: vi.fn(),
  },
  log: { server: vi.fn() },
  LogLevel: {
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
  },
}));

// One ZoneMinder server log line of the shape zmc writes: the ffmpeg command
// with the camera credential in it (refs #307).
vi.mock('../../api/logs', () => ({
  getZMLogs: vi.fn().mockResolvedValue({
    logs: [
      {
        Log: {
          Id: 1,
          TimeKey: '1700000000.0',
          Component: 'zmc_m1',
          Level: 0,
          Message: "Starting capture: ffmpeg -i rtsp://admin:S3cret@cam.lan:554/h264",
          File: 'zmc.cpp',
          Line: '42',
          Pid: '123',
        },
      },
    ],
  }),
  getZMLogLevel: () => 'INFO',
  getUniqueZMComponents: () => ['zmc_m1'],
}));

vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn(),
  },
}));

vi.mock('../../lib/version', () => ({
  getAppVersion: () => '1.0.0',
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-1', name: 'Test Profile', apiUrl: 'https://api.test' },
    settings: { logLevel: 1 },
    hasProfile: true,
  }),
}));

vi.mock('../../stores/settings', () => ({
  DEFAULT_SETTINGS: {
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'light',
    logLevel: 1,
  },
  useSettingsStore: vi.fn((selector: any) => {
    if (typeof selector === 'function') {
      return selector({
        profileSettings: {},
        updateProfileSettings: vi.fn(),
      });
    }
    return vi.fn();
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockTruncate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/log-file', () => ({
  getLogFile: () => ({
    truncate: mockTruncate,
    readAll: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    revealLocation: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    capabilities: { share: false, reveal: false },
  }),
}));

describe('Logs Page', () => {
  it('renders log entries and clears logs', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    expect(screen.getAllByTestId('log-entry')).toHaveLength(3);

    await user.click(screen.getByTestId('logs-clear-button'));
    await user.click(screen.getByTestId('logs-clear-confirm'));
    expect(clearLogs).toHaveBeenCalled();
    expect(mockTruncate).toHaveBeenCalled();
  });

  it('filters logs by component', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    await user.click(screen.getByTestId('log-component-filter-trigger'));
    await user.click(screen.getByTestId('log-component-filter-checkbox-auth'));

    expect(screen.getAllByTestId('log-entry')).toHaveLength(1);
  });

  it('redacts the camera credential in a ZoneMinder server log line', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    await user.click(screen.getByTestId('log-source-server'));

    const entry = await screen.findByText(/Starting capture/);
    expect(entry.textContent).not.toContain('S3cret');
    expect(entry.textContent).toContain('cam.lan');
  });
});
