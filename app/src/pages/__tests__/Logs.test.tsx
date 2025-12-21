import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Logs from '../Logs';

const clearLogs = vi.fn();

vi.mock('../../stores/logs', () => ({
  useLogStore: (selector: (state: { logs: any[]; clearLogs: typeof clearLogs }) => unknown) =>
    selector({
      logs: [
        {
          id: 'log-1',
          timestamp: '2024-01-01T00:00:00Z',
          level: 'INFO',
          message: 'Test log',
        },
      ],
      clearLogs,
    }),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    getLevel: () => 1,
    setLevel: vi.fn(),
  },
  LogLevel: {
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
  },
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('Logs Page', () => {
  it('renders log entries and clears logs', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    expect(screen.getByTestId('log-entry')).toBeInTheDocument();

    await user.click(screen.getByTestId('logs-clear-button'));
    expect(clearLogs).toHaveBeenCalled();
  });
});
