import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZoneLegend } from '../ZoneLegend';
import type { Zone } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const z = (Id: number, Type: string, MonitorId = 1): Zone =>
  ({ Id, MonitorId, Name: `Z${Id}`, Type, NumCoords: 4,
     Coords: '0,0 1,0 1,1 0,1' } as unknown as Zone);

describe('ZoneLegend', () => {
  it('shows one row per present type, in palette order', () => {
    render(<ZoneLegend visible monitorId="1" zones={[z(1, 'Inactive'), z(2, 'Active')]} />);
    expect(screen.getByTestId('zone-legend')).toBeInTheDocument();
    expect(screen.getByTestId('zone-legend-row-Active')).toBeInTheDocument();
    expect(screen.getByTestId('zone-legend-row-Inactive')).toBeInTheDocument();
    // Active precedes Inactive in the DOM (palette order)
    const rows = screen.getAllByTestId(/zone-legend-row-/);
    expect(rows[0].getAttribute('data-testid')).toBe('zone-legend-row-Active');
  });

  it('omits types not present', () => {
    render(<ZoneLegend visible monitorId="1" zones={[z(1, 'Active')]} />);
    expect(screen.queryByTestId('zone-legend-row-Privacy')).not.toBeInTheDocument();
  });

  it('filters to the current monitor', () => {
    render(<ZoneLegend visible monitorId="1" zones={[z(1, 'Active', 2)]} />);
    expect(screen.queryByTestId('zone-legend')).not.toBeInTheDocument();
  });

  it('renders nothing when not visible', () => {
    render(<ZoneLegend visible={false} monitorId="1" zones={[z(1, 'Active')]} />);
    expect(screen.queryByTestId('zone-legend')).not.toBeInTheDocument();
  });
});
