/**
 * View preferences resolve two-tier (refs #337): a monitor's own server owns
 * them in single mode, the ALL bucket owns them while aggregating, so one
 * setting governs every tile regardless of which server the tile came from.
 *
 * Streaming Mode is a tri-state in All mode, held in its own ALL-bucket
 * setting: 'per-server' (the default) leaves each tile on its owning server's
 * mode, so aggregating must never silently impose snapshot on servers that
 * stream.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewPrefs, usePageViewMode } from '../useViewPrefs';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../api/types';
import type { Profile } from '../../api/types';

const profile = (id: string): Profile => ({
  id: asProfileId(id),
  name: id,
  portalUrl: 'http://localhost',
  apiUrl: 'http://localhost/api',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: false,
  createdAt: 0,
});

/** A group over profile-2 only, so a test can tell "the group's bucket" from
 *  "the ALL bucket" by which one governs profile-2's tile. */
const GROUP = mintVirtualProfileId();

/** The ALL bucket starts at its defaults, which means 'per-server'. Tests
 *  that need an imposed mode set one. */
const seed = (viewMode: 'streaming' | 'snapshot') => {
  useProfileStore.setState({
    profiles: [profile('profile-1'), profile('profile-2')],
    currentProfileId: asProfileId('profile-1'),
    virtualProfiles: [
      { id: GROUP, name: 'Backyard', memberProfileIds: [asProfileId('profile-2')] },
    ],
  });
  useSettingsStore.setState({
    profileSettings: {
      'profile-1': { ...DEFAULT_SETTINGS, viewMode, showAnalysisFrames: false },
      'profile-2': { ...DEFAULT_SETTINGS, viewMode, showAnalysisFrames: false },
    },
  });
};

describe('useViewPrefs', () => {
  beforeEach(() => seed('streaming'));

  it('reads the owning profile in single mode', () => {
    useSettingsStore.getState().updateProfileSettings('profile-2', {
      viewMode: 'snapshot',
      showAnalysisFrames: true,
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.viewMode).toBe('snapshot');
    expect(result.current.showAnalysisFrames).toBe(true);
  });

  it('falls back to the current profile when given no owner', () => {
    useSettingsStore.getState().updateProfileSettings('profile-1', { viewMode: 'snapshot' });

    const { result } = renderHook(() => useViewPrefs());

    expect(result.current.viewMode).toBe('snapshot');
  });

  // The regression 980859d2 introduced: an unwritten ALL bucket merged to
  // snapshot, turning every All-mode tile into a still with no way back.
  it('follows the owning profile in All mode while the mode is per-server', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.viewMode).toBe('streaming');
  });

  it('lets an explicit All-Servers snapshot mode win over a streaming owner', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      allModeViewMode: 'snapshot',
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.viewMode).toBe('snapshot');
  });

  it('lets an explicit All-Servers streaming mode win over a snapshot owner', () => {
    seed('snapshot');
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      allModeViewMode: 'streaming',
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.viewMode).toBe('streaming');
  });

  // A group is an aggregate in its own right: the bucket that governs its
  // tiles is its own, never All Servers'. Both buckets are written here with
  // opposite modes, so only the right one can produce this result.
  it("lets the active group's own bucket win over the ALL bucket", () => {
    seed('snapshot');
    useProfileStore.setState({ currentProfileId: GROUP });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      allModeViewMode: 'snapshot',
    });
    useSettingsStore.getState().updateProfileSettings(GROUP, {
      allModeViewMode: 'streaming',
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.viewMode).toBe('streaming');
  });

  it("reads analysis frames from the active group's bucket", () => {
    useProfileStore.setState({ currentProfileId: GROUP });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      showAnalysisFrames: false,
    });
    useSettingsStore.getState().updateProfileSettings(GROUP, {
      showAnalysisFrames: true,
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.showAnalysisFrames).toBe(true);
  });

  // Analysis frames stay a plain two-state preference: off is a coherent
  // default, so there is nothing to distinguish "unset" from.
  it('lets the ALL bucket own analysis frames in All mode', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      showAnalysisFrames: true,
    });

    const { result } = renderHook(() => useViewPrefs(asProfileId('profile-2')));

    expect(result.current.showAnalysisFrames).toBe(true);
  });
});

describe('usePageViewMode', () => {
  beforeEach(() => seed('streaming'));

  it('reads the current profile in single mode', () => {
    useSettingsStore.getState().updateProfileSettings('profile-1', { viewMode: 'snapshot' });

    const { result } = renderHook(() => usePageViewMode());

    expect(result.current).toBe('snapshot');
  });

  it('reports streaming in All mode when any server streams under per-server', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings('profile-1', { viewMode: 'snapshot' });

    // profile-2 still streams, so a page-level control is not dead.
    const { result } = renderHook(() => usePageViewMode());

    expect(result.current).toBe('streaming');
  });

  it('reports snapshot in All mode when every server is on snapshot', () => {
    seed('snapshot');
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });

    const { result } = renderHook(() => usePageViewMode());

    expect(result.current).toBe('snapshot');
  });

  it('reports the mode the active group imposes, not the ALL bucket\'s', () => {
    seed('snapshot');
    useProfileStore.setState({ currentProfileId: GROUP });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      allModeViewMode: 'snapshot',
    });
    useSettingsStore.getState().updateProfileSettings(GROUP, {
      allModeViewMode: 'streaming',
    });

    const { result } = renderHook(() => usePageViewMode());

    expect(result.current).toBe('streaming');
  });

  it('reports the imposed All-Servers mode when one is set', () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      allModeViewMode: 'snapshot',
    });

    const { result } = renderHook(() => usePageViewMode());

    expect(result.current).toBe('snapshot');
  });
});
