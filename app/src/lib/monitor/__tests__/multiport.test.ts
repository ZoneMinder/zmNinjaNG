import { describe, it, expect, beforeEach } from 'vitest';
import { resolveMinStreamingPort, getEffectiveMinStreamingPort } from '../multiport';
import { getMonitorStreamUrl } from '../../zm/url-builder';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../../stores/settings';
import type { Profile } from '../../../api/types';

describe('resolveMinStreamingPort', () => {
  it('returns the raw port when the override is off', () => {
    expect(resolveMinStreamingPort(8000, false)).toBe(8000);
  });

  it('returns undefined when the override is on', () => {
    expect(resolveMinStreamingPort(8000, true)).toBeUndefined();
  });

  it('treats undefined override as off', () => {
    expect(resolveMinStreamingPort(8000, undefined)).toBe(8000);
  });

  it('returns undefined when there is no server port', () => {
    expect(resolveMinStreamingPort(undefined, false)).toBeUndefined();
    expect(resolveMinStreamingPort(null, false)).toBeUndefined();
  });

  it('drops the per-monitor port in the resulting stream URL when forced off', () => {
    const portalUrl = 'https://zm.example.com';
    const withPort = getMonitorStreamUrl(`${portalUrl}/cgi-bin/nph-zms`, '5', {
      minStreamingPort: resolveMinStreamingPort(8000, false),
    });
    const forcedOff = getMonitorStreamUrl(`${portalUrl}/cgi-bin/nph-zms`, '5', {
      minStreamingPort: resolveMinStreamingPort(8000, true),
    });
    // 8000 + monitor 5 = 8005 when on
    expect(new URL(withPort).port).toBe('8005');
    // No custom port (default for https) when forced off
    expect(new URL(forcedOff).port).toBe('');
  });
});

describe('getEffectiveMinStreamingPort', () => {
  const profileId = 'p1';
  const profile = { id: profileId, name: 'Test', minStreamingPort: 9000 } as Profile;

  beforeEach(() => {
    useProfileStore.setState({ profiles: [profile], currentProfileId: profile.id });
    useSettingsStore.setState({
      profileSettings: { [profileId]: { ...DEFAULT_SETTINGS } },
    });
  });

  it('returns the profile port when the override is off', () => {
    expect(getEffectiveMinStreamingPort(profileId)).toBe(9000);
  });

  it('returns undefined when the override is on', () => {
    useSettingsStore.setState({
      profileSettings: { [profileId]: { ...DEFAULT_SETTINGS, forceDisableMultiPort: true } },
    });
    expect(getEffectiveMinStreamingPort(profileId)).toBeUndefined();
  });

  it('returns undefined for an unknown or null profile id', () => {
    expect(getEffectiveMinStreamingPort('nope')).toBeUndefined();
    expect(getEffectiveMinStreamingPort(null)).toBeUndefined();
  });

  it('defaults the setting to off (auto)', () => {
    expect(DEFAULT_SETTINGS.forceDisableMultiPort).toBe(false);
  });
});
