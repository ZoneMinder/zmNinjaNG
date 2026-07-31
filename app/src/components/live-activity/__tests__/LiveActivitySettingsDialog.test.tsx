import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LiveActivitySettingsDialog } from '../LiveActivitySettingsDialog';
import { useSettingsStore } from '../../../stores/settings';
import { useAuthStore } from '../../../stores/auth';

const MONITORS = [
  { Monitor: { Id: '3', Name: 'Front Door', Function: 'Modect' } },
  { Monitor: { Id: '4', Name: 'Backyard', Function: 'Modect' } },
];

// Mocord records continuously on the pre-1.38 schema the tests below run on.
const MONITORS_WITH_CONTINUOUS = [
  ...MONITORS,
  { Monitor: { Id: '5', Name: 'Driveway', Function: 'Mocord' } },
];

describe('LiveActivitySettingsDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
    useAuthStore.setState({ version: '1.36.33' });
  });

  it('persists a changed dwell value to the profile settings on blur', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    const input = screen.getByTestId('live-activity-dwell-input');
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);

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

  // A continuous recorder is skipped by default, so its toggle drives the
  // opt-in list rather than the ignore list. Seeding the ignore list instead
  // would make the automatic default indistinguishable from a user's choice.
  describe('continuous-recording monitors', () => {
    function renderDialog() {
      return render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId="p1"
          monitors={MONITORS_WITH_CONTINUOUS as never}
        />
      );
    }

    it('shows a continuous recorder as off, and says why, without ignoring it', () => {
      renderDialog();

      expect(screen.getByTestId('live-activity-ignore-5')).toHaveAttribute(
        'data-state',
        'unchecked'
      );
      expect(screen.getByTestId('live-activity-continuous-hint-5')).toBeInTheDocument();
      expect(screen.queryByTestId('live-activity-continuous-hint-3')).not.toBeInTheDocument();
      expect(
        useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
      ).toEqual([]);
    });

    it('opts a continuous recorder in without touching the ignore list', () => {
      renderDialog();

      fireEvent.click(screen.getByTestId('live-activity-ignore-5'));

      const settings = useSettingsStore.getState().getProfileSettings('p1');
      expect(settings.liveActivityWatchContinuousIds).toEqual(['5']);
      expect(settings.liveActivityIgnoredMonitorIds).toEqual([]);
    });

    it('drops a continuous recorder back out when it is toggled off again', () => {
      useSettingsStore.getState().updateProfileSettings('p1', {
        liveActivityWatchContinuousIds: ['5'],
      });

      renderDialog();
      expect(screen.getByTestId('live-activity-ignore-5')).toHaveAttribute(
        'data-state',
        'checked'
      );

      fireEvent.click(screen.getByTestId('live-activity-ignore-5'));

      expect(
        useSettingsStore.getState().getProfileSettings('p1').liveActivityWatchContinuousIds
      ).toEqual([]);
    });

    it('treats an alarm-only monitor normally on ZM 1.38+', () => {
      useAuthStore.setState({ version: '1.38.0' });
      render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId="p1"
          monitors={
            [...MONITORS, { Monitor: { Id: '5', Name: 'Driveway', Function: 'Mocord', Recording: 'OnMotion' } }] as never
          }
        />
      );

      expect(screen.queryByTestId('live-activity-continuous-hint-5')).not.toBeInTheDocument();
      expect(screen.getByTestId('live-activity-ignore-5')).toHaveAttribute('data-state', 'checked');
    });
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

  it('does not commit on change alone; the store only updates once the field blurs', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    const input = screen.getByTestId('live-activity-poll-input');
    fireEvent.change(input, { target: { value: '15' } });
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);

    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(15);
  });

  it('clamps an out-of-range poll interval to the nearest bound and shows the clamped value', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    const input = screen.getByTestId('live-activity-poll-input');
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(60);
    expect(input).toHaveValue(60);
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

    // The floor is deliberately non-zero: a zero dwell disables the damping
    // that keeps tiles from thrashing nph-zms connections.
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityDwellSeconds
    ).toBe(5);

    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);
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
    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityMaxTiles
    ).toBe(1);

    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityMaxTiles
    ).toBe(40);
  });

  it('does not write a garbage value when a field is emptied and left blank on blur', () => {
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
    fireEvent.blur(input);

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);
    expect(input).toHaveValue(5);
  });

  it('does not write NaN when a non-numeric value is entered and left on blur', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    const input = screen.getByTestId('live-activity-poll-input');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);
    expect(input).toHaveValue(5);
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
    expect(input).toHaveValue(null);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);

    fireEvent.change(input, { target: { value: '15' } });
    expect(input).toHaveValue(15);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);

    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(15);
  });

  it('commits typed digits one at a time without the resync effect corrupting them', () => {
    // Regression test: a resync-on-every-commit design clamps "1" to the
    // minimum (2) and redraws the draft, so the next keystroke appends to
    // "2" and produces "22" instead of "12". Firing one change event per
    // character (as real typing does) plus a final blur must still land on
    // 12, not 22 and not some other corrupted value.
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );
    const input = screen.getByTestId('live-activity-poll-input');

    fireEvent.change(input, { target: { value: '1' } });
    expect(input).toHaveValue(1);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);

    fireEvent.change(input, { target: { value: '12' } });
    expect(input).toHaveValue(12);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(5);

    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(12);
  });

  it('commits on Enter without requiring a blur', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );
    const input = screen.getByTestId('live-activity-poll-input');

    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(20);
  });

  it('keeps an in-progress edit on screen when an external write lands mid-focus, and resyncs once unfocused', () => {
    // This pins the intended conflict policy; it is not a regression test.
    // The earlier sync guard advanced its last-seen marker even while the
    // field had focus, which was a defensive defect rather than an
    // observable one: commit() on blur always ends with
    // setDraft(String(clamped)), so the draft is re-anchored to the store on
    // every path out of focus and both versions of the guard render the same
    // value and leave the same store value. A differential harness that ran
    // the old and new components through 4000 random 7-step and 1500 random
    // 12-step sequences of focus, typing, Enter, blur, and external writes
    // found no sequence where they differ, and the same harness did report
    // differences once the old guard was deliberately mutated.
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );
    const input = screen.getByTestId('live-activity-poll-input');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '20' } });

    // Something else writes this profile's settings while the field is
    // still focused. The in-progress edit must not be yanked out from
    // under the user.
    act(() => {
      useSettingsStore.getState().updateProfileSettings('p1', { liveActivityPollSeconds: 45 });
    });
    expect(input).toHaveValue(20);

    // Blurring commits the user's own typed value, superseding the write
    // that landed mid-edit (deliberate policy: the in-progress edit wins).
    fireEvent.blur(input);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(20);
    expect(input).toHaveValue(20);

    // A later external change, with the field no longer focused, must still
    // sync normally.
    act(() => {
      useSettingsStore.getState().updateProfileSettings('p1', { liveActivityPollSeconds: 33 });
    });
    expect(input).toHaveValue(33);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(33);
  });
});
