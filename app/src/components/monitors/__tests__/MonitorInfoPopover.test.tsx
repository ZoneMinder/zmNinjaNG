/**
 * MonitorInfoPopover: the capture pipeline and stream facts behind one info
 * button, with labels, so a touch user sees what "Always / Always / OnMotion"
 * meant, and Decoding gets a home in the UI (refs #467).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonitorInfoPopover } from '../MonitorInfoPopover';
import type { Monitor } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modern = {
  Id: '3',
  Name: 'Driveway',
  Capturing: 'Always',
  Analysing: 'Always',
  Recording: 'OnMotion',
  Decoding: 'Ondemand',
  Width: '1920',
  Height: '1080',
  MaxFPS: '15',
  Controllable: '1',
} as Monitor;

function open() {
  fireEvent.click(screen.getByTestId('monitor-info-btn'));
  return screen.getByTestId('monitor-info-popover');
}

describe('MonitorInfoPopover', () => {
  it('lists the labelled capture pipeline, Decoding included, on ZM 1.38+', () => {
    render(<MonitorInfoPopover monitor={modern} />);
    const popover = open();

    expect(popover).toHaveTextContent('Driveway');
    for (const [label, value] of [
      ['monitors.capturing', 'Always'],
      ['monitors.analysing', 'Always'],
      ['monitors.recording', 'OnMotion'],
      ['monitors.decoding', 'Ondemand'],
    ]) {
      expect(screen.getByTestId(`monitor-info-${label.split('.')[1]}`)).toHaveTextContent(value);
      expect(popover).toHaveTextContent(label);
    }
    expect(screen.getByTestId('monitor-info-resolution')).toHaveTextContent('1920x1080');
    expect(screen.getByTestId('monitor-info-max_fps')).toHaveTextContent('15');
  });

  it('treats Decoding as a plain row, no note and no emphasis', () => {
    render(<MonitorInfoPopover monitor={modern} />);
    const popover = open();
    expect(popover).not.toHaveTextContent('monitors.decoding_on_demand_note');
    expect(screen.getByTestId('monitor-info-decoding').className).not.toMatch(/amber/);
  });

  it('falls back to Function on servers without the split fields', () => {
    const legacy = { Id: '4', Name: 'Yard', Function: 'Modect', Width: '640', Height: '480', MaxFPS: null } as Monitor;
    render(<MonitorInfoPopover monitor={legacy} />);
    const popover = open();

    expect(screen.getByTestId('monitor-info-function')).toHaveTextContent('Modect');
    expect(popover).not.toHaveTextContent('monitors.capturing');
    expect(popover).not.toHaveTextContent('monitors.decoding');
    expect(screen.getByTestId('monitor-info-max_fps')).toHaveTextContent('monitors.unlimited');
  });

  it('does not let the click reach a clickable parent', () => {
    const onParentClick = vi.fn();
    render(
      <button type="button" onClick={onParentClick}>
        <MonitorInfoPopover monitor={modern} />
      </button>,
    );
    open();
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
