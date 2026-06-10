import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MontageTileErrorBoundary } from '../MontageTileErrorBoundary';
import { log } from '../../../lib/logger';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return {
    ...actual,
    log: { ...actual.log, montageMonitor: vi.fn() },
  };
});

function Bomb(): never {
  throw new Error('tile boom');
}

describe('MontageTileErrorBoundary', () => {
  beforeEach(() => {
    // Silence React's error boundary console output for the intentional throw
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when no error occurs', () => {
    render(
      <MontageTileErrorBoundary monitorId="1" monitorName="Front Door">
        <div data-testid="tile-content" />
      </MontageTileErrorBoundary>
    );
    expect(screen.getByTestId('tile-content')).toBeInTheDocument();
    expect(screen.queryByTestId('montage-tile-error')).not.toBeInTheDocument();
  });

  it('renders the fallback with the monitor name when the child throws', () => {
    render(
      <MontageTileErrorBoundary monitorId="3" monitorName="Driveway">
        <Bomb />
      </MontageTileErrorBoundary>
    );
    const fallback = screen.getByTestId('montage-tile-error');
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveTextContent('Driveway');
    expect(fallback).toHaveTextContent('montage.tile_error');
  });

  it('keeps a sibling tile rendered when one tile crashes', () => {
    render(
      <div>
        <MontageTileErrorBoundary monitorId="1" monitorName="Broken">
          <Bomb />
        </MontageTileErrorBoundary>
        <MontageTileErrorBoundary monitorId="2" monitorName="Healthy">
          <div data-testid="healthy-tile">healthy stream</div>
        </MontageTileErrorBoundary>
      </div>
    );
    expect(screen.getByTestId('montage-tile-error')).toBeInTheDocument();
    expect(screen.getByTestId('healthy-tile')).toBeInTheDocument();
    expect(screen.getByText('healthy stream')).toBeInTheDocument();
  });

  it('logs the caught error with the monitor id and name', () => {
    render(
      <MontageTileErrorBoundary monitorId="7" monitorName="Garage">
        <Bomb />
      </MontageTileErrorBoundary>
    );
    expect(log.montageMonitor).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ monitorId: '7', monitorName: 'Garage' })
    );
  });
});
