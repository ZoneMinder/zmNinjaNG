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
    expect(poly.getAttribute('fill')).toBe('#4b5563');
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
    expect(screen.getByTestId('zone-polygon-2').getAttribute('fill')).toBe('#4b5563');
  });

  it('shows the translated zone type in the hover label', () => {
    render(<ZoneOverlay {...base} zones={[zone({ Id: 3, Type: 'Preclusive' })]} />);
    fireEvent.mouseEnter(screen.getByTestId('zone-polygon-3'));
    expect(screen.getByText('monitor_detail.zone_type.preclusive')).toBeInTheDocument();
  });

  /**
   * ZoneMinder 1.39 stores zones in percent of the frame and says so in the
   * zone's Units field. Drawn into the pixel viewBox without scaling, a
   * full-frame zone on a 2560x1920 monitor covered the top-left four percent
   * of the picture instead of all of it.
   */
  it('scales a percent zone across the whole frame', () => {
    render(
      <ZoneOverlay
        {...base}
        monitorWidth={2560}
        monitorHeight={1920}
        zones={[zone({ Id: 9, Coords: '0,0 100,0 100,100 0,100' })]}
      />
    );

    expect(screen.getByTestId('zone-polygon-9')).toHaveAttribute(
      'points',
      '0,0 2560,0 2560,1920 0,1920'
    );
  });

  it('leaves a pixel zone in its own coordinates', () => {
    render(
      <ZoneOverlay
        {...base}
        monitorWidth={2560}
        monitorHeight={1920}
        zones={[zone({ Id: 10, Units: 'Pixels', Coords: '0,0 2560,0 2560,1920 0,1920' })]}
      />
    );

    expect(screen.getByTestId('zone-polygon-10')).toHaveAttribute(
      'points',
      '0,0 2560,0 2560,1920 0,1920'
    );
  });

  /**
   * A zone's Units field describes its analysis parameters, not its
   * coordinates, and the column now defaults to Percent. A zone carried over
   * from an older server can therefore say Percent over pixel coords, and
   * scaling those would throw the polygon far off the frame.
   */
  it('keeps a pixel zone that claims Percent units', () => {
    render(
      <ZoneOverlay
        {...base}
        monitorWidth={2560}
        monitorHeight={1920}
        zones={[zone({ Id: 13, Units: 'Percent', Coords: '756,387 1551,513 1656,1970 696,1812' })]}
      />
    );

    expect(screen.getByTestId('zone-polygon-13')).toHaveAttribute(
      'points',
      '756,387 1551,513 1656,1970 696,1812'
    );
  });

  /**
   * The overlay sits on top of the feed and must be letterboxed or cropped the
   * same way the picture is. The feed's object-fit comes from a user setting,
   * so a hardcoded 'meet' put the zones at contain scale over a picture the
   * user had set to cover or fill.
   */
  it.each([
    ['contain', 'xMidYMid meet'],
    ['cover', 'xMidYMid slice'],
    ['fill', 'none'],
    ['scale-down', 'xMidYMid meet'],
    ['none', 'xMidYMid slice'],
  ] as const)('matches the feed fit %s with preserveAspectRatio %s', (fit, expected) => {
    render(<ZoneOverlay {...base} objectFit={fit} zones={[zone({ Id: 11 })]} />);
    expect(screen.getByTestId('zone-overlay')).toHaveAttribute('preserveAspectRatio', expected);
  });

  it('letterboxes like contain when the caller names no fit', () => {
    render(<ZoneOverlay {...base} zones={[zone({ Id: 12 })]} />);
    expect(screen.getByTestId('zone-overlay')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('renders nothing when not visible', () => {
    render(<ZoneOverlay {...base} visible={false} zones={[zone({ Id: 1 })]} />);
    expect(screen.queryByTestId('zone-overlay')).not.toBeInTheDocument();
  });
});
