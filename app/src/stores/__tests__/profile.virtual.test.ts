/**
 * Virtual profiles: the profile store's second namespace (refs #337).
 *
 * A virtual profile is a named group of real profiles. It has no server, no
 * session and no credentials - only an id, a name, and a member list - so
 * everything here is about the entity's lifecycle and the hygiene that keeps
 * membership, settings buckets and the current selection consistent with it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useProfileStore } from '../profile';
import { useAuthStore } from '../auth';
import { useSettingsStore } from '../settings';
import { useDashboardStore } from '../dashboard';
import { useMonitorSeenStore } from '../monitorSeen';
import { setQueryClient } from '../query-cache';
import { createStoreApiClient } from '../../api/store-gates';
import { asProfileId, isVirtualProfileId, ALL_PROFILES_ID } from '../../api/types';
import { dropAllSessions, hasSession } from '../../services/sessions';
import { useDeleteSelectionStore, eventSelectionKey } from '../deleteSelection';

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));

vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(undefined),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    profile: vi.fn(),
    profileService: vi.fn(),
    dashboard: vi.fn(),
    auth: vi.fn(),
    notifications: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

const server = (id: string, name: string) => ({
  id: asProfileId(id),
  name,
  apiUrl: `http://${id}`,
  portalUrl: `http://${id}`,
  cgiUrl: `http://${id}/cgi-bin`,
  isDefault: false,
  createdAt: 1,
});

describe('virtual profiles in the profile store', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [server('p1', 'Home'), server('p2', 'Away')],
      virtualProfiles: [],
      currentProfileId: asProfileId('p1'),
      isInitialized: true,
    });
    useSettingsStore.setState({ profileSettings: {} });
    useDashboardStore.setState({ widgets: {} });
    useMonitorSeenStore.setState({ profileWatermarks: {} });
    useAuthStore.setState({ slices: {} });
    useDeleteSelectionStore.getState().clear();
    dropAllSessions();
    setQueryClient(new QueryClient());
    vi.clearAllMocks();

    let n = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++n}` });
  });

  describe('addVirtualProfile', () => {
    it('mints a prefixed id and stores the name and members', () => {
      const id = useProfileStore
        .getState()
        .addVirtualProfile('Upstairs', [asProfileId('p1'), asProfileId('p2')]);

      expect(isVirtualProfileId(id)).toBe(true);
      expect(useProfileStore.getState().virtualProfiles).toEqual([
        { id, name: 'Upstairs', memberProfileIds: ['p1', 'p2'] },
      ]);
    });

    it('mints a distinct id per group', () => {
      const a = useProfileStore.getState().addVirtualProfile('A', [asProfileId('p1')]);
      const b = useProfileStore.getState().addVirtualProfile('B', [asProfileId('p2')]);

      expect(a).not.toBe(b);
    });

    it('rejects an empty member list', () => {
      expect(() => useProfileStore.getState().addVirtualProfile('Nobody', [])).toThrow();
      expect(useProfileStore.getState().virtualProfiles).toEqual([]);
    });

    it('rejects a name a real profile already holds', () => {
      expect(() =>
        useProfileStore.getState().addVirtualProfile('home', [asProfileId('p1')])
      ).toThrow('already exists');
      expect(useProfileStore.getState().virtualProfiles).toEqual([]);
    });

    it('rejects a name another virtual profile already holds', () => {
      useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      expect(() =>
        useProfileStore.getState().addVirtualProfile('UPSTAIRS', [asProfileId('p2')])
      ).toThrow('already exists');
      expect(useProfileStore.getState().virtualProfiles).toHaveLength(1);
    });
  });

  it('rejects a real profile taking a name a virtual profile already holds', async () => {
    useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

    await expect(
      useProfileStore.getState().addProfile({
        name: 'upstairs',
        portalUrl: 'https://new.test',
        apiUrl: 'https://new.test',
        cgiUrl: 'https://new.test/cgi-bin',
        isDefault: false,
      })
    ).rejects.toThrow('already exists');
  });

  it('rejects renaming a real profile onto a virtual profile\'s name', async () => {
    useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

    await expect(
      useProfileStore.getState().updateProfile('p2', { name: 'Upstairs' })
    ).rejects.toThrow('already exists');
  });

  describe('updateVirtualProfile', () => {
    it('renames a group and replaces its members', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      useProfileStore
        .getState()
        .updateVirtualProfile(id, { name: 'Downstairs', memberProfileIds: [asProfileId('p2')] });

      expect(useProfileStore.getState().virtualProfiles).toEqual([
        { id, name: 'Downstairs', memberProfileIds: ['p2'] },
      ]);
    });

    it('lets a group keep its own name', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      useProfileStore.getState().updateVirtualProfile(id, { name: 'Upstairs', memberProfileIds: [asProfileId('p2')] });

      expect(useProfileStore.getState().virtualProfiles[0].memberProfileIds).toEqual(['p2']);
    });

    it('rejects taking another profile\'s name', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      expect(() => useProfileStore.getState().updateVirtualProfile(id, { name: 'Away' })).toThrow(
        'already exists'
      );
      expect(useProfileStore.getState().virtualProfiles[0].name).toBe('Upstairs');
    });

    it('rejects emptying the member list', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      expect(() =>
        useProfileStore.getState().updateVirtualProfile(id, { memberProfileIds: [] })
      ).toThrow();
      expect(useProfileStore.getState().virtualProfiles[0].memberProfileIds).toEqual(['p1']);
    });

    it('rejects an unknown group', () => {
      expect(() =>
        useProfileStore.getState().updateVirtualProfile('__virtual_nope', { name: 'X' })
      ).toThrow('not found');
    });
  });

  describe('deleteVirtualProfile', () => {
    it('deletes the group and its own settings and widget buckets, leaving every other bucket alone', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
      useSettingsStore.getState().updateProfileSettings(id, { streamMaxFps: 42 });
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { streamMaxFps: 7 });
      useSettingsStore.getState().updateProfileSettings('p1', { streamMaxFps: 3 });
      useDashboardStore.getState().addWidget(id, { type: 'monitor', title: 'W', settings: {}, layout: { w: 1, h: 1 } });
      useDashboardStore.getState().addWidget('p1', { type: 'monitor', title: 'W', settings: {}, layout: { w: 1, h: 1 } });

      useProfileStore.getState().deleteVirtualProfile(id);

      expect(useProfileStore.getState().virtualProfiles).toEqual([]);
      // The group's own buckets are gone, not merely reset to defaults.
      expect(useSettingsStore.getState().profileSettings[id]).toBeUndefined();
      expect(useDashboardStore.getState().widgets[id]).toBeUndefined();
      // Neither the All bucket nor a member's bucket is touched.
      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).streamMaxFps).toBe(7);
      expect(useSettingsStore.getState().getProfileSettings('p1').streamMaxFps).toBe(3);
      expect(useDashboardStore.getState().widgets['p1']).toHaveLength(1);
    });

    it('never deletes the member profiles themselves', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1'), asProfileId('p2')]);

      useProfileStore.getState().deleteVirtualProfile(id);

      expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['p1', 'p2']);
    });

    it('resets the current selection when the deleted group was current', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
      useProfileStore.setState({ currentProfileId: id });

      useProfileStore.getState().deleteVirtualProfile(id);

      expect(useProfileStore.getState().currentProfileId).toBeNull();
    });

    it('leaves the current selection alone when another group is deleted', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      useProfileStore.getState().deleteVirtualProfile(id);

      expect(useProfileStore.getState().currentProfileId).toBe('p1');
    });

    it('drops a queued bulk delete, like every other profile-context change', () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
      useDeleteSelectionStore.getState().toggle(eventSelectionKey(asProfileId('p1'), '5'));

      useProfileStore.getState().deleteVirtualProfile(id);

      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });
  });

  describe('membership hygiene', () => {
    it('deleting a real profile prunes it from every group', async () => {
      const both = useProfileStore.getState().addVirtualProfile('Both', [asProfileId('p1'), asProfileId('p2')]);
      const only = useProfileStore.getState().addVirtualProfile('Only p1', [asProfileId('p1')]);

      await useProfileStore.getState().deleteProfile('p1');

      const groups = useProfileStore.getState().virtualProfiles;
      expect(groups.find((g) => g.id === both)?.memberProfileIds).toEqual(['p2']);
      // A group can be left empty; scope resolution collapses it to null.
      expect(groups.find((g) => g.id === only)?.memberProfileIds).toEqual([]);
    });

    it('deleting every profile clears the groups too', async () => {
      useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      await useProfileStore.getState().deleteAllProfiles();

      expect(useProfileStore.getState().virtualProfiles).toEqual([]);
    });
  });

  describe('switchProfile', () => {
    it('switches to a virtual profile without building a session or running bootstrap', async () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      await useProfileStore.getState().switchProfile(id);

      expect(useProfileStore.getState().currentProfileId).toBe(id);
      expect(hasSession(id)).toBe(false);
      expect(createStoreApiClient).not.toHaveBeenCalled();
    });

    it('writes no lastUsed for an aggregate switch', async () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

      await useProfileStore.getState().switchProfile(id);

      expect(useProfileStore.getState().profiles.every((p) => p.lastUsed === undefined)).toBe(true);
    });

    it('drops a queued bulk delete', async () => {
      const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
      useDeleteSelectionStore.getState().toggle(eventSelectionKey(asProfileId('p1'), '5'));

      await useProfileStore.getState().switchProfile(id);

      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });

    it('rejects an unknown virtual id, leaving the selection alone', async () => {
      await expect(useProfileStore.getState().switchProfile('__virtual_ghost')).rejects.toThrow(
        'not found'
      );
      expect(useProfileStore.getState().currentProfileId).toBe('p1');
    });
  });
});
