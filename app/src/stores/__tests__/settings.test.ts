import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore, ALL_GROUPS_KEY, migrateSettings, SETTINGS_VERSION } from '../settings';
import type { ProfileSettings } from '../settings';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';

let isNative = false;
vi.mock('../../lib/platform', () => ({ Platform: { get isNative() { return isNative; } } }));

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
    // Continuous event playback (#250): off by default, 1x speed.
    expect(settings.eventContinuousPlay).toBe(false);
    expect(settings.eventPlaybackRate).toBe(1);
  });

  it('persists continuous playback toggle and speed (#250)', () => {
    const profileId = 'profile-cp';
    useSettingsStore.getState().updateProfileSettings(profileId, {
      eventContinuousPlay: true,
      eventPlaybackRate: 2,
    });
    const settings = useSettingsStore.getState().getProfileSettings(profileId);
    expect(settings.eventContinuousPlay).toBe(true);
    expect(settings.eventPlaybackRate).toBe(2);
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
  it('defaults the assistant off with the on-device backend and default model', () => {
    const s = useSettingsStore.getState().getProfileSettings('new-profile');
    expect(s.assistantEnabled).toBe(false);
    expect(s.assistantBackend).toBe('on-device');
    expect(s.assistantModelId).toBe(ASSISTANT.defaultModelId);
  });

  it('leaves the ollama backend fields unset so the URL can fall back to the ZoneMinder host', () => {
    const s = useSettingsStore.getState().getProfileSettings('new-profile');
    // Deliberately empty rather than localhost: an unset URL is resolved
    // against the profile's own ZoneMinder host at use time, and localhost
    // would mean the phone itself on mobile.
    expect(s.assistantOllamaBaseUrl).toBe('');
    expect(s.assistantOllamaModel).toBe('');
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

  // v1 -> v2: `Qwen2.5-3B-Instruct-q4f16_1-MLC` left webllmModels (refs #246).
  // A saved copy is still a real registry id, so it would not throw; it would
  // silently load an unlisted model while the picker, bound to the same value,
  // matched no <option> and rendered blank. Rewriting it is what keeps the
  // stored value and the picker agreeing.
  describe('v2 retired assistant model ids', () => {
    it('rewrites a retired model id to its replacement', () => {
      const persisted = {
        profileSettings: {
          'profile-a': { assistantModelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', theme: 'dark' },
        },
      };
      const migrated = migrateSettings(persisted, 1) as {
        profileSettings: Record<string, ProfileSettings>;
      };
      expect(migrated.profileSettings['profile-a'].assistantModelId).toBe('Llama-3.2-3B-Instruct-q4f16_1-MLC');
      expect(migrated.profileSettings['profile-a'].theme).toBe('dark');
    });

    it('leaves a still-listed model id alone', () => {
      const persisted = {
        profileSettings: {
          'profile-a': { assistantModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC' },
        },
      };
      const migrated = migrateSettings(persisted, 1) as {
        profileSettings: Record<string, ProfileSettings>;
      };
      expect(migrated.profileSettings['profile-a'].assistantModelId).toBe(
        'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      );
    });

    it('rewrites a retired id carried up through the v0 migration', () => {
      const legacy = {
        profileSettings: {
          'profile-a': { assistantModelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', montageGridCols: 3 },
        },
      };
      const migrated = migrateSettings(legacy, 0) as {
        profileSettings: Record<string, ProfileSettings>;
      };
      // Both steps ran: the v0 reshape AND the v2 id rewrite.
      expect(migrated.profileSettings['profile-a'].assistantModelId).toBe('Llama-3.2-3B-Instruct-q4f16_1-MLC');
      expect(migrated.profileSettings['profile-a'].montageByGroup[ALL_GROUPS_KEY].gridCols).toBe(3);
    });

    it('leaves settings without an assistantModelId untouched', () => {
      const persisted = { profileSettings: { 'profile-a': { theme: 'dark' } } };
      const migrated = migrateSettings(persisted, 1) as {
        profileSettings: Record<string, Record<string, unknown>>;
      };
      expect('assistantModelId' in migrated.profileSettings['profile-a']).toBe(false);
    });

    // A store already at v2 (anyone who ran the app after the Qwen2.5 rewrite
    // shipped) must still get later retirements: zustand only calls migrate
    // when the stored version is BELOW the current one, so a retirement added
    // without bumping the version silently never runs.
    it('rewrites an id retired after v2, for a store already at v2', () => {
      const persisted = {
        profileSettings: { 'profile-a': { assistantModelId: 'gemma3-1b-it-q4f16_1-MLC' } },
      };
      const migrated = migrateSettings(persisted, 2) as {
        profileSettings: Record<string, ProfileSettings>;
      };
      expect(migrated.profileSettings['profile-a'].assistantModelId).toBe(
        'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      );
    });

    // The rewrite only reaches an existing install if the persist version is
    // above the one that install last stored, so the version has to move with
    // the retirement list. This is the coupling that makes the migration real
    // rather than dead code.
    it('the persist version is at least the number of retirements plus the v1 reshape', () => {
      expect(SETTINGS_VERSION).toBeGreaterThanOrEqual(
        Object.keys(ASSISTANT.retiredModelIds).length + 1,
      );
    });

    it('every retired id maps to a model that is actually in the list', () => {
      const listed = new Set<string>(ASSISTANT.webllmModels.map((m) => m.id));
      for (const [retired, replacement] of Object.entries(ASSISTANT.retiredModelIds)) {
        expect(listed.has(replacement), `${retired} -> ${replacement}`).toBe(true);
        expect(listed.has(retired), `${retired} is retired, so must not be listed`).toBe(false);
      }
    });
  });
});

// On-device now means WebGPU, which phones do not have: the native runtime
// that used to back it was removed. Hiding the option in Settings does nothing
// for a profile that already stored it, so the value itself is corrected.
describe('assistant backend migration for mobile', () => {
  it('moves a phone profile off on-device', () => {
    isNative = true;
    const persisted = { profileSettings: { 'profile-a': { assistantBackend: 'on-device' } } };

    const migrated = migrateSettings(persisted, 1) as { profileSettings: Record<string, ProfileSettings> };
    expect(migrated.profileSettings['profile-a'].assistantBackend).toBe('ollama');
  });

  it('leaves desktop alone, where on-device still works', () => {
    isNative = false;
    const persisted = { profileSettings: { 'profile-a': { assistantBackend: 'on-device' } } };

    const migrated = migrateSettings(persisted, 1) as { profileSettings: Record<string, ProfileSettings> };
    expect(migrated.profileSettings['profile-a'].assistantBackend).toBe('on-device');
  });

  it('leaves an Ollama profile untouched on a phone', () => {
    isNative = true;
    const persisted = { profileSettings: { 'profile-a': { assistantBackend: 'ollama', assistantOllamaModel: 'llama3.2' } } };

    const migrated = migrateSettings(persisted, 1) as { profileSettings: Record<string, ProfileSettings> };
    expect(migrated.profileSettings['profile-a']).toMatchObject({
      assistantBackend: 'ollama',
      assistantOllamaModel: 'llama3.2',
    });
  });
});
