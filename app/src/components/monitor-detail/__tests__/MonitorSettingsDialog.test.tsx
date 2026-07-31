/**
 * MonitorSettingsDialog save-diff tests.
 *
 * The dialog derives reset, change-detection, and the save payload from one
 * field-descriptor list. These tests lock the behavior that matters: Save is
 * disabled until something changes, and the payload contains only the fields
 * the user actually edited.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonitorSettingsDialog } from '../MonitorSettingsDialog';
import type { Monitor } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let disableLogRedaction = false;
let forceZmsMonitorIds: string[] = [];

const settingsState = {
  getProfileSettings: () => ({
    streamingMethod: 'auto',
    monitorStreamingOverrides: {},
    forceZmsMonitorIds,
    disableLogRedaction,
  }),
  updateProfileSettings: vi.fn(),
};

vi.mock('../../../stores/settings', () => ({
  useSettingsStore: (sel: (s: typeof settingsState) => unknown) => sel(settingsState),
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' } }),
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const baseMonitor = {
  Id: '1',
  Name: 'Front Door',
  Type: 'Ffmpeg',
  Capturing: 'Always',
  Analysing: 'Always',
  Recording: 'OnMotion',
  Function: 'Modect',
  Enabled: '1',
  SaveJPEGs: '0',
  VideoWriter: '0',
  Path: 'rtsp://cam/stream',
  User: '',
  Pass: '',
  Method: 'rtpRtsp',
  MaxFPS: '',
  AlarmMaxFPS: '',
  Orientation: 'ROTATE_0',
  EventStartCommand: '',
  EventEndCommand: '',
  Width: '640',
  Height: '480',
  Colours: '4',
  Controllable: '0',
  Go2RTCEnabled: false,
} as unknown as Monitor;

describe('MonitorSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disableLogRedaction = false;
    forceZmsMonitorIds = [];
  });

  it('keeps Save disabled until a field changes', () => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={vi.fn()}
      />
    );
    expect(screen.getByTestId('settings-video-save-button')).toBeDisabled();
  });

  it('sends only the edited field in the save payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByTestId('settings-source-input'), {
      target: { value: 'rtsp://cam/new-stream' },
    });

    const saveButton = screen.getByTestId('settings-video-save-button');
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://cam/new-stream' });
  });
});

/**
 * "Always use ZMS for events" (#313).
 *
 * An app-local preference keyed by monitor id, not a ZoneMinder monitor column.
 * It applies the moment it is toggled, so it must never enter the dialog's
 * change detection nor its save payload: sending it would ask ZM to write a
 * field it does not have.
 */
describe('MonitorSettingsDialog force-ZMS toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disableLogRedaction = false;
    forceZmsMonitorIds = [];
  });

  const renderDialog = (onSave = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
      />
    );
    return onSave;
  };

  const toggle = () => screen.getByTestId('settings-monitor-force-zms-switch');

  it('is off for a monitor that is not on the list', () => {
    renderDialog();
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('is on for a monitor already on the list', () => {
    forceZmsMonitorIds = ['1'];
    renderDialog();
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('adds the monitor to the setting the moment it is switched on', () => {
    renderDialog();

    fireEvent.click(toggle());

    expect(settingsState.updateProfileSettings).toHaveBeenCalledWith('p1', {
      forceZmsMonitorIds: ['1'],
    });
  });

  it('removes only this monitor when switched off', () => {
    forceZmsMonitorIds = ['1', '4'];
    renderDialog();

    fireEvent.click(toggle());

    expect(settingsState.updateProfileSettings).toHaveBeenCalledWith('p1', {
      forceZmsMonitorIds: ['4'],
    });
  });

  it('leaves Save disabled and keeps the setting out of the ZM payload', async () => {
    const onSave = renderDialog();

    fireEvent.click(toggle());
    expect(screen.getByTestId('settings-video-save-button')).toBeDisabled();

    fireEvent.change(screen.getByTestId('settings-source-input'), {
      target: { value: 'rtsp://cam/new-stream' },
    });
    fireEvent.click(screen.getByTestId('settings-video-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://cam/new-stream' });
  });
});

/**
 * Camera credentials on screen (refs #307).
 *
 * Pre-1.38 ZoneMinder has nowhere to put a camera password but the source URL,
 * so `Path` is where the secret usually is. While log redaction is on, the
 * password segment is masked and the reveal toggle is gone, but both fields
 * stay editable: a user changing a camera's hostname must not be forced to
 * retype a password they cannot see.
 */
describe('MonitorSettingsDialog credential masking', () => {
  const credentialMonitor = {
    ...baseMonitor,
    Path: 'rtsp://admin:S3cret@cam.lan:554/h264',
    Pass: 'S3cret',
  } as unknown as Monitor;

  const renderDialog = (onSave = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={credentialMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
      />
    );
    return onSave;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    disableLogRedaction = false;
  });

  it('masks the password in the source path but keeps the host readable', () => {
    renderDialog();
    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;
    expect(input.value).not.toContain('S3cret');
    expect(input.value).toContain('cam.lan:554/h264');
    expect(input.value).toContain('admin');
  });

  it('hides the password reveal toggle while redaction is on', () => {
    renderDialog();
    expect(screen.queryByLabelText('common.show_password')).toBeNull();
  });

  it('restores the real password when the user edits the host around the mask', async () => {
    const onSave = renderDialog();
    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: input.value.replace('cam.lan', 'newcam.lan') } });
    fireEvent.click(screen.getByTestId('settings-video-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://admin:S3cret@newcam.lan:554/h264' });
  });

  it('saves a password the user typed over the mask', async () => {
    const onSave = renderDialog();

    fireEvent.change(screen.getByTestId('settings-source-input'), {
      target: { value: 'rtsp://admin:brandNew@cam.lan:554/h264' },
    });
    fireEvent.click(screen.getByTestId('settings-video-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://admin:brandNew@cam.lan:554/h264' });
  });

  it('keeps Save disabled when only the mask is on screen', () => {
    renderDialog();
    expect(screen.getByTestId('settings-video-save-button')).toBeDisabled();
  });

  it('shows the real path and the reveal toggle once redaction is turned off', () => {
    disableLogRedaction = true;
    renderDialog();

    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;
    expect(input.value).toBe('rtsp://admin:S3cret@cam.lan:554/h264');
    expect(screen.getByLabelText('common.show_password')).toBeTruthy();
  });
});
