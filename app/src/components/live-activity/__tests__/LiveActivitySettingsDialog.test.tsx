import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { LiveActivitySettingsDialog } from '../LiveActivitySettingsDialog';
import { useSettingsStore } from '../../../stores/settings';
import { ALL_PROFILES_ID, asProfileId } from '../../../api/types';

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');
const ALL_ID = ALL_PROFILES_ID;

// Radix's Select relies on portals/pointer APIs jsdom doesn't fully support
// (same mock as components/__tests__/profile-picker.test.tsx).
const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" {...props} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

const MONITORS = [
  { Monitor: { Id: '3', Name: 'Front Door', Function: 'Modect' } },
  { Monitor: { Id: '4', Name: 'Backyard', Function: 'Modect' } },
];

// Mocord records continuously on the pre-1.38 schema.
const MONITORS_WITH_CONTINUOUS = [
  ...MONITORS,
  { Monitor: { Id: '5', Name: 'Driveway', Function: 'Mocord' } },
];

describe('LiveActivitySettingsDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('persists a changed dwell value to the profile settings on blur', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId={P1}
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
        profileId={P1}
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual(['4']);
  });

  // A continuous recorder is treated like any other monitor: recording mode
  // says nothing about what is alarming, so the row carries no special hint
  // and no separate opt-in list (#313).
  it('shows a continuous recorder as watched, with no hint of its own', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId={P1}
        monitors={MONITORS_WITH_CONTINUOUS as never}
      />
    );

    expect(screen.getByTestId('live-activity-ignore-5')).toHaveAttribute('data-state', 'checked');
    expect(screen.queryByText(/continuously/i)).not.toBeInTheDocument();
  });

  it('removes a monitor from the ignore list when it is toggled back on', () => {
    useSettingsStore.getState().updateProfileSettings('p1', {
      liveActivityIgnoredMonitorIds: ['4'],
    });

    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId={P1}
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual([]);
  });

  // Regression: this dialog is page-mounted and Radix only toggles it
  // open/closed, so it never unmounts - `pickedProfileId` used to be a
  // mount-time snapshot with nothing to invalidate it. Any in-app profile
  // switch while the dialog had been opened before (including single mode
  // -> a different single profile, not just an All-mode re-pick) left the
  // ignore list reading and WRITING the stale profile's bucket forever
  // after. No existing test rerenders with a changed profileId, which is
  // why this slipped through.
  it("follows a live profileId change across a rerender, not a stale mount-time snapshot", () => {
    const { rerender } = render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId={P1}
        monitors={MONITORS as never}
      />
    );

    rerender(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId={P2}
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p2').liveActivityIgnoredMonitorIds
    ).toEqual(['4']);
    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual([]);
  });

  it('does not commit on change alone; the store only updates once the field blurs', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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
        profileId={P1}
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

  // All mode: `profileId` is the ALL bucket (view-level poll/dwell/tiles);
  // the ignore list is a per-server data preference, so it edits whichever
  // profile is picked via the shared ProfilePicker, never the ALL bucket
  // (refs #337, two-tier rule in AGENTS.project.md's Aggregation contract).
  describe('All mode (scopeProfiles provided)', () => {
    const SCOPE_PROFILES = [
      {
        profile: { id: 'p1', name: 'One' } as never,
        monitors: [{ Monitor: { Id: '3', Name: 'p1-cam3', Function: 'Modect' } }] as never,
      },
      {
        profile: { id: 'p2', name: 'Two' } as never,
        monitors: [{ Monitor: { Id: '3', Name: 'p2-cam3', Function: 'Modect' } }] as never,
      },
    ];

    it('shows the first scope profile\'s monitors by default, not the single-mode monitors prop', () => {
      render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId={ALL_ID}
          monitors={MONITORS as never}
          scopeProfiles={SCOPE_PROFILES}
        />
      );

      expect(screen.getByText('p1-cam3')).toBeInTheDocument();
      expect(screen.queryByText('Front Door')).not.toBeInTheDocument();
    });

    it("writes an ignore toggle to the PICKED profile's own bucket, never the ALL bucket", () => {
      render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId={ALL_ID}
          monitors={MONITORS as never}
          scopeProfiles={SCOPE_PROFILES}
        />
      );

      fireEvent.click(screen.getByTestId('live-activity-ignore-3'));

      expect(
        useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
      ).toEqual(['3']);
      expect(
        useSettingsStore.getState().getProfileSettings(ALL_ID).liveActivityIgnoredMonitorIds
      ).toEqual([]);
    });

    it('switches the shown monitors and ignore state when a different profile is picked', () => {
      useSettingsStore.getState().updateProfileSettings('p2', {
        liveActivityIgnoredMonitorIds: ['3'],
      });

      render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId={ALL_ID}
          monitors={MONITORS as never}
          scopeProfiles={SCOPE_PROFILES}
        />
      );

      fireEvent.click(screen.getByTestId('page-profile-picker-option-p2'));

      expect(screen.getByText('p2-cam3')).toBeInTheDocument();
      expect(screen.getByTestId('live-activity-ignore-3')).toHaveAttribute('data-state', 'unchecked');
    });

    it('still writes poll/dwell/tiles to the ALL bucket (profileId), not the picked profile', () => {
      render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId={ALL_ID}
          monitors={MONITORS as never}
          scopeProfiles={SCOPE_PROFILES}
        />
      );

      const input = screen.getByTestId('live-activity-dwell-input');
      fireEvent.change(input, { target: { value: '60' } });
      fireEvent.blur(input);

      expect(
        useSettingsStore.getState().getProfileSettings(ALL_ID).liveActivityDwellSeconds
      ).toBe(60);
      expect(
        useSettingsStore.getState().getProfileSettings('p1').liveActivityDwellSeconds
      ).toBe(30); // default, untouched
    });

    it('hides the profile picker in single mode (no scopeProfiles)', () => {
      render(
        <LiveActivitySettingsDialog
          open
          onOpenChange={() => {}}
          profileId={P1}
          monitors={MONITORS as never}
        />
      );

      expect(screen.queryByTestId('page-profile-picker')).not.toBeInTheDocument();
    });
  });
});
