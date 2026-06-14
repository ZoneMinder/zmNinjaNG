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

const settingsState = {
  getProfileSettings: () => ({ streamingMethod: 'auto', monitorStreamingOverrides: {} }),
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
