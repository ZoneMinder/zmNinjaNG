import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonitorCard } from '../MonitorCard';

vi.mock('../../../hooks/useMonitorStream', () => ({
  useMonitorStream: () => ({
    streamUrl: 'https://stream.test',
    displayedImageUrl: '',
    imgRef: { current: null },
    regenerateConnection: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('MonitorCard', () => {
  it('calls settings callback when settings button is clicked', async () => {
    const user = userEvent.setup();
    const onShowSettings = vi.fn();

    render(
      <MonitorCard
        monitor={{
          Id: '1',
          Name: 'Front Door',
          Type: 'Local',
          Function: 'Monitor',
          Enabled: '1',
          Controllable: '0',
          Width: '640',
          Height: '480',
        }}
        status={{ Status: 'Connected', CaptureFPS: '10' }}
        eventCount={3}
        onShowSettings={onShowSettings}
      />
    );

    await user.click(screen.getByTestId('monitor-settings-button'));

    expect(onShowSettings).toHaveBeenCalledWith(
      expect.objectContaining({ Id: '1', Name: 'Front Door' })
    );
  });
});
