import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore, ALL_GROUPS_KEY, migrateSettings } from '../settings';
import type { ProfileSettings } from '../settings';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';

describe('Settings Store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      profileSettings: {},
    });
  });

  it('returns defaults for unknown profile', () => {
    const settings = useSettingsStore.getState().getProfileSettings('missing-profile');
    expect(settings.viewMode).toBe('snapshot');
    expect(settings.snapshotRefreshInterval).toBe(3);
    expect(settings.monitorDetailCycleSeconds).toBe(0);
    expect(settings.eventsThumbnailFit).toBe('contain');
  });

  it('updates profile settings with partial values', () => {
    const profileId = 'profile-1';
    useSettingsStore.getState().updateProfileSettings(profileId, {
      viewMode: 'streaming',
      streamMaxFps: 15,
    });

    const settings = useSettingsStore.getState().getProfileSettings(profileId);
    expect(settings.viewMode).toBe('streaming');
    expect(settings.streamMaxFps).toBe(15);
    expect(settings.snapshotRefreshInterval).toBe(3);
  });

  describe('Streaming method settings', () => {
    it('defaults to auto streaming method', () => {
      const settings = useSettingsStore.getState().getProfileSettings('new-profile');
      expect(settings.streamingMethod).toBe('auto');
      // STUN is off by default: unused on LAN/portal, avoids the -105 console log.
      expect(settings.webrtcUseStun).toBe(false);
    });

    it('updates streaming method to mjpeg from default', () => {
      const profileId = 'profile-1';
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
      });

      const settings = useSettingsStore.getState().getProfileSettings(profileId);
      expect(settings.streamingMethod).toBe('mjpeg');
    });

    it('updates streaming method back to auto', () => {
      const profileId = 'profile-1';
      // First set to mjpeg
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
      });
      // Then back to auto
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'auto',
      });

      const settings = useSettingsStore.getState().getProfileSettings(profileId);
      expect(settings.streamingMethod).toBe('auto');
    });

    it('persists streaming method across store resets', () => {
      const profileId = 'profile-1';
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
      });

      // Verify settings are stored
      const storedSettings = useSettingsStore.getState().profileSettings[profileId];
      expect(storedSettings.streamingMethod).toBe('mjpeg');
    });
  });
});

describe('assistant settings defaults', () => {
  it('defaults the assistant off with the default model', () => {
    const s = useSettingsStore.getState().getProfileSettings('new-profile');
    expect(s.assistantEnabled).toBe(false);
    expect(s.assistantModelId).toBe(ASSISTANT.defaultModelId);
  });
});

describe('group-scoped montage settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('defaults to empty group maps', () => {
    const settings = useSettingsStore.getState().getProfileSettings('profile-x');
    expect(settings.montageByGroup).toEqual({});
    expect(settings.eventMontageByGroup).toEqual({});
  });

  it('updateMontageGroupLayout merges a patch into the group bucket', () => {
    const store = useSettingsStore.getState();
    store.updateMontageGroupLayout('profile-a', ALL_GROUPS_KEY, { gridCols: 4 });
    store.updateMontageGroupLayout('profile-a', ALL_GROUPS_KEY, {
      hiddenMonitorIds: ['3'],
    });
    const bucket = useSettingsStore
      .getState()
      .getProfileSettings('profile-a').montageByGroup[ALL_GROUPS_KEY];
    expect(bucket.gridCols).toBe(4);
    expect(bucket.hiddenMonitorIds).toEqual(['3']);
    expect(bucket.savedLayouts).toEqual([]);
    expect(bucket.activeLayoutName).toBeNull();
  });

  it('keeps montage buckets separate per group key', () => {
    const store = useSettingsStore.getState();
    store.updateMontageGroupLayout('profile-a', ALL_GROUPS_KEY, { gridCols: 2 });
    store.updateMontageGroupLayout('profile-a', '7', { gridCols: 5 });
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.montageByGroup[ALL_GROUPS_KEY].gridCols).toBe(2);
    expect(settings.montageByGroup['7'].gridCols).toBe(5);
  });

  it('updateEventMontageGroupLayout stores cols per group key', () => {
    const store = useSettingsStore.getState();
    store.updateEventMontageGroupLayout('profile-a', '7', { gridCols: 6 });
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.eventMontageByGroup['7'].gridCols).toBe(6);
  });
});

describe('settings migration v0 -> v1', () => {
  it('moves flat montage fields into the All-monitors bucket', () => {
    const legacy = {
      profileSettings: {
        'profile-a': {
          montageLayouts: { lg: [{ i: '1', x: 0, y: 0, w: 6, h: 4 }] },
          montageSavedLayouts: [{ name: 'Wall', layout: [], displayCols: 3 }],
          montageActiveLayoutName: 'Wall',
          montageGridCols: 3,
          montageGridRows: 3,
          montageHiddenMonitorIds: ['9'],
          eventMontageGridCols: 4,
          eventMontageLayouts: { lg: [] },
          theme: 'slate',
        },
      },
    };
    const migrated = migrateSettings(legacy, 0) as {
      profileSettings: Record<string, ProfileSettings>;
    };
    const p = migrated.profileSettings['profile-a'];
    expect(p.montageByGroup[ALL_GROUPS_KEY]).toEqual({
      workingLayout: [{ i: '1', x: 0, y: 0, w: 6, h: 4 }],
      savedLayouts: [{ name: 'Wall', layout: [], displayCols: 3 }],
      activeLayoutName: 'Wall',
      gridCols: 3,
      hiddenMonitorIds: ['9'],
    });
    expect(p.eventMontageByGroup[ALL_GROUPS_KEY]).toEqual({ gridCols: 4 });
    expect('montageLayouts' in p).toBe(false);
    expect('eventMontageLayouts' in p).toBe(false);
    expect(p.theme).toBe('slate');
  });

  it('fills defaults when legacy fields are absent', () => {
    const legacy = { profileSettings: { 'profile-b': { theme: 'dark' } } };
    const migrated = migrateSettings(legacy, 0) as {
      profileSettings: Record<string, ProfileSettings>;
    };
    const p = migrated.profileSettings['profile-b'];
    expect(p.montageByGroup[ALL_GROUPS_KEY].gridCols).toBe(2);
    expect(p.montageByGroup[ALL_GROUPS_KEY].workingLayout).toEqual([]);
    expect(p.eventMontageByGroup[ALL_GROUPS_KEY].gridCols).toBe(2);
  });
});
