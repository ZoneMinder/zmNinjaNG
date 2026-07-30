import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveActivitySettingsDialog } from '../LiveActivitySettingsDialog';
import { useSettingsStore } from '../../../stores/settings';

const MONITORS = [
  { Monitor: { Id: '3', Name: 'Front Door' } },
  { Monitor: { Id: '4', Name: 'Backyard' } },
];

describe('LiveActivitySettingsDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('persists a changed dwell value to the profile settings', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.change(screen.getByTestId('live-activity-dwell-input'), {
      target: { value: '60' },
    });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityDwellSeconds
    ).toBe(60);
  });

  it('adds a monitor to the ignore list when it is toggled off', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual(['4']);
  });

  it('removes a monitor from the ignore list when it is toggled back on', () => {
    useSettingsStore.getState().updateProfileSettings('p1', {
      liveActivityIgnoredMonitorIds: ['4'],
    });

    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual([]);
  });

  it('clamps an out-of-range poll interval instead of storing it', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.change(screen.getByTestId('live-activity-poll-input'), {
      target: { value: '9999' },
    });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(60);
  });

  it('clamps the dwell input at both its lower and upper bound', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );
    const input = screen.getByTestId('live-activity-dwell-input');

    fireEvent.change(input, { target: { value: '-5' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityDwellSeconds
    ).toBe(0);

    fireEvent.change(input, { target: { value: '9999' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityDwellSeconds
    ).toBe(300);
  });

  it('clamps the max-tiles input at both its lower and upper bound', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );
    const input = screen.getByTestId('live-activity-tiles-input');

    fireEvent.change(input, { target: { value: '0' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityMaxTiles
    ).toBe(1);

    fireEvent.change(input, { target: { value: '9999' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityMaxTiles
    ).toBe(40);
  });

  it('does not write a garbage value when a field is emptied', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.change(screen.getByTestId('live-activity-poll-input'), {
      target: { value: '' },
    });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);
  });

  it('does not write NaN when a non-numeric value is entered', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.change(screen.getByTestId('live-activity-poll-input'), {
      target: { value: 'abc' },
    });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);
  });

  it('lets a field be cleared and retyped without clobbering the store mid-edit', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );
    const input = screen.getByTestId('live-activity-poll-input');

    fireEvent.change(input, { target: { value: '' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);
    expect(input).toHaveValue(null);

    fireEvent.change(input, { target: { value: '15' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(15);
    expect(input).toHaveValue(15);
  });
});
