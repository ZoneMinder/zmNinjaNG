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

const settingsState = {
  getProfileSettings: () => ({
    streamingMethod: 'auto',
    monitorStreamingOverrides: {},
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
