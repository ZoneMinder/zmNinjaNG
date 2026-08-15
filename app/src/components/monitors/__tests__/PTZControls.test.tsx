import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PTZControls } from '../PTZControls';
import type { ZMControl } from '../../../api/types';
import { UI_INTERACTIONS } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Permission probe (refs #344). Tests set the verdict they need.
let mockControlPermission: string | undefined;
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    permissions: mockControlPermission === undefined ? undefined : { control: mockControlPermission },
    isLoading: false,
  }),
}));

// jsdom does not implement pointer capture; the pointerdown handler calls it.
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Continuous-drive control: one start command, no repeat timer. */
const continuousControl = {
  CanMove: '1',
  CanMoveCon: '1',
} as ZMControl;

/** Relative-drive control: the step command repeats on a timer while held. */
const relativeControl = {
  CanMove: '1',
  CanMoveRel: '1',
} as ZMControl;

const POINTER = { pointerId: 1 };

describe('PTZControls panel', () => {
  // tests/steps/ptz.steps.ts asserts this testid. It went missing once and the
  // e2e guard (Controllable === 0 on the test server) hid the breakage.
  it('marks the panel root with the ptz-controls testid', () => {
    render(<PTZControls onCommand={vi.fn()} control={continuousControl} />);
    expect(screen.getByTestId('ptz-controls')).toBeInTheDocument();
  });

  it('renders nothing when the monitor has no control definition', () => {
    const { container } = render(<PTZControls onCommand={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PTZControls hold button', () => {
  it('sends the stop command when unmounted while a button is held', () => {
    const onCommand = vi.fn();
    const { unmount } = render(<PTZControls onCommand={onCommand} control={continuousControl} />);

    fireEvent.pointerDown(screen.getByTestId('ptz-right'), POINTER);
    expect(onCommand).toHaveBeenCalledWith('moveConRight');
    onCommand.mockClear();

    unmount();

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith('moveStop');
  });

  it('clears the repeat interval when unmounted while a button is held', () => {
    vi.useFakeTimers();
    const onCommand = vi.fn();
    const { unmount } = render(<PTZControls onCommand={onCommand} control={relativeControl} />);

    fireEvent.pointerDown(screen.getByTestId('ptz-up'), POINTER);
    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs);
    // One press + one repeat tick.
    expect(onCommand.mock.calls.filter(([c]) => c === 'moveRelUp')).toHaveLength(2);

    unmount();
    onCommand.mockClear();

    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs * 5);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('sends no command when unmounted with no button held', () => {
    const onCommand = vi.fn();
    const { unmount } = render(<PTZControls onCommand={onCommand} control={continuousControl} />);

    unmount();

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('sends no stop command after the pointer was already released', () => {
    const onCommand = vi.fn();
    const { unmount } = render(<PTZControls onCommand={onCommand} control={continuousControl} />);

    const button = screen.getByTestId('ptz-left');
    fireEvent.pointerDown(button, POINTER);
    fireEvent.pointerUp(button, POINTER);
    expect(onCommand).toHaveBeenNthCalledWith(1, 'moveConLeft');
    expect(onCommand).toHaveBeenNthCalledWith(2, 'moveStop');
    onCommand.mockClear();

    unmount();

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('fires the command on press and the stop command on release, ending the repeat', () => {
    vi.useFakeTimers();
    const onCommand = vi.fn();
    render(<PTZControls onCommand={onCommand} control={relativeControl} />);

    const button = screen.getByTestId('ptz-down');
    fireEvent.pointerDown(button, POINTER);
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('moveRelDown');

    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs * 2);
    expect(onCommand.mock.calls.filter(([c]) => c === 'moveRelDown')).toHaveLength(3);

    fireEvent.pointerUp(button, POINTER);
    expect(onCommand).toHaveBeenLastCalledWith('moveStop');
    onCommand.mockClear();

    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs * 5);
    expect(onCommand).not.toHaveBeenCalled();
  });
});

/**
 * PTZ needs its own ZoneMinder permission (refs #344).
 *
 * `ajax/control.php` gates on canView('Control', id): a camera being
 * controllable is a property of the hardware, and Control is the user's right
 * to use it. Those are different questions, and only the second one decides
 * whether these buttons can do anything.
 */
describe('PTZControls without control permission', () => {
  const control = { CanMove: '1', CanMoveCon: '1', CanZoom: '1' } as unknown as ZMControl;

  afterEach(() => {
    mockControlPermission = undefined;
  });

  it('renders nothing when ZoneMinder denies control', () => {
    mockControlPermission = 'None';

    render(<PTZControls onCommand={vi.fn()} control={control} />);

    expect(screen.queryByTestId('ptz-controls')).not.toBeInTheDocument();
  });

  it('renders at View, which is all ZoneMinder asks for', () => {
    mockControlPermission = 'View';

    render(<PTZControls onCommand={vi.fn()} control={control} />);

    expect(screen.getByTestId('ptz-controls')).toBeInTheDocument();
  });

  it('renders while the permission is unknown', () => {
    render(<PTZControls onCommand={vi.fn()} control={control} />);

    expect(screen.getByTestId('ptz-controls')).toBeInTheDocument();
  });
});

/**
 * The pad must offer only the axes the driver has. ZoneMinder's own pad hides
 * up/down without CanTilt and left/right without CanPan
 * (skins/classic/includes/control_functions.php); a pan-only driver such as a
 * single-servo mount rejects every tilt command, so an arrow that sends one is
 * a button that cannot work.
 *
 * `invisible` keeps the 3x3 grid from reflowing, which is how the diagonals
 * were already handled.
 */
describe('PTZControls axis capabilities', () => {
  const isHidden = (testId: string) =>
    screen.getByTestId(testId).className.includes('invisible');

  it('hides the tilt arrows and keeps pan when the driver cannot tilt', () => {
    const panOnly = {
      CanMove: '1', CanMoveCon: '1', CanPan: '1', CanTilt: '0',
    } as unknown as ZMControl;

    render(<PTZControls onCommand={vi.fn()} control={panOnly} />);

    expect(isHidden('ptz-up')).toBe(true);
    expect(isHidden('ptz-down')).toBe(true);
    expect(isHidden('ptz-left')).toBe(false);
    expect(isHidden('ptz-right')).toBe(false);
  });

  it('hides the pan arrows and keeps tilt when the driver cannot pan', () => {
    const tiltOnly = {
      CanMove: '1', CanMoveCon: '1', CanPan: '0', CanTilt: '1',
    } as unknown as ZMControl;

    render(<PTZControls onCommand={vi.fn()} control={tiltOnly} />);

    expect(isHidden('ptz-left')).toBe(true);
    expect(isHidden('ptz-right')).toBe(true);
    expect(isHidden('ptz-up')).toBe(false);
    expect(isHidden('ptz-down')).toBe(false);
  });

  it('hides the diagonals when an axis is missing, even with CanMoveDiag', () => {
    const panOnlyDiag = {
      CanMove: '1', CanMoveCon: '1', CanPan: '1', CanTilt: '0', CanMoveDiag: '1',
    } as unknown as ZMControl;

    render(<PTZControls onCommand={vi.fn()} control={panOnlyDiag} />);

    for (const id of ['ptz-up-left', 'ptz-up-right', 'ptz-down-left', 'ptz-down-right']) {
      expect(isHidden(id)).toBe(true);
    }
  });

  it('shows every arrow when a control definition omits the axis fields', () => {
    const legacy = { CanMove: '1', CanMoveCon: '1', CanMoveDiag: '1' } as unknown as ZMControl;

    render(<PTZControls onCommand={vi.fn()} control={legacy} />);

    for (const id of ['ptz-up', 'ptz-down', 'ptz-left', 'ptz-right', 'ptz-up-left']) {
      expect(isHidden(id)).toBe(false);
    }
  });
});
