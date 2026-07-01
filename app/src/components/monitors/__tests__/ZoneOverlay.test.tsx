import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneOverlay } from '../ZoneOverlay';
import type { Zone } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function zone(overrides: Partial<Zone>): Zone {
  return {
    Id: 1, MonitorId: 1, Name: 'Z1', Type: 'Active', Units: 'Pixels',
    NumCoords: 4, Coords: '0,0 100,0 100,100 0,100', Area: 10000,
    AlarmRGB: 16711680, // red
    ...overrides,
  } as unknown as Zone;
}

const base = {
  monitorWidth: 100, monitorHeight: 100,
  rotation: { kind: 'none' } as never, monitorId: '1', visible: true,
};

describe('ZoneOverlay', () => {
  it('colors an inactive zone by type (gray), ignoring red AlarmRGB', () => {
    render(<ZoneOverlay {...base} zones={[zone({ Id: 7, Type: 'Inactive' })]} />);
    const poly = screen.getByTestId('zone-polygon-7');
    expect(poly.getAttribute('fill')).toBe('#9ca3af');
    expect(poly.getAttribute('fill')).not.toBe('#ff0000');
  });

  it('colors different types differently', () => {
    render(
      <ZoneOverlay {...base} zones={[
        zone({ Id: 1, Type: 'Active' }),
        zone({ Id: 2, Type: 'Inactive' }),
      ]} />
    );
    expect(screen.getByTestId('zone-polygon-1').getAttribute('fill')).toBe('#22c55e');
    expect(screen.getByTestId('zone-polygon-2').getAttribute('fill')).toBe('#9ca3af');
  });

  it('shows the translated zone type in the hover label', () => {
    render(<ZoneOverlay {...base} zones={[zone({ Id: 3, Type: 'Preclusive' })]} />);
    fireEvent.mouseEnter(screen.getByTestId('zone-polygon-3'));
    expect(screen.getByText('monitor_detail.zone_type.preclusive')).toBeInTheDocument();
  });

  it('renders nothing when not visible', () => {
    render(<ZoneOverlay {...base} visible={false} zones={[zone({ Id: 1 })]} />);
    expect(screen.queryByTestId('zone-overlay')).not.toBeInTheDocument();
  });
});
