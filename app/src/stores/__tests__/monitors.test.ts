import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMonitorStore, monitorCacheKey } from '../monitors';
import { asProfileId } from '../../api/types';

describe('Monitor Store', () => {
  beforeEach(() => {
    useMonitorStore.setState({ connKeys: {} });
    vi.spyOn(Math, 'random').mockReturnValue(0.12345);
  });

  it('returns existing connection key', () => {
    useMonitorStore.setState({ connKeys: { '1': 999 } });

    const key = useMonitorStore.getState().getConnKey('1');

    expect(key).toBe(999);
  });

  it('creates a new connection key when missing', () => {
    const key = useMonitorStore.getState().getConnKey('2');

    expect(key).toBe(12345);
    expect(useMonitorStore.getState().connKeys['2']).toBe(12345);
  });

  it('regenerates connection key', () => {
    const key = useMonitorStore.getState().regenerateConnKey('3');

    expect(key).toBe(12345);
    expect(useMonitorStore.getState().connKeys['3']).toBe(12345);
  });

  it('clears a stored connection key without touching other monitors', () => {
    useMonitorStore.setState({ connKeys: { '1': 999, '2': 888 } });

    useMonitorStore.getState().clearConnKey('1');

    expect(useMonitorStore.getState().connKeys['1']).toBeUndefined();
    expect(useMonitorStore.getState().connKeys['2']).toBe(888);
  });

  it('clearConnKey is a no-op for an unknown monitor', () => {
    useMonitorStore.setState({ connKeys: { '1': 999 } });

    useMonitorStore.getState().clearConnKey('77');

    expect(useMonitorStore.getState().connKeys).toEqual({ '1': 999 });
  });

  it('getConnKey generates a fresh key after clearConnKey', () => {
    useMonitorStore.setState({ connKeys: { '1': 999 } });

    useMonitorStore.getState().clearConnKey('1');
    const key = useMonitorStore.getState().getConnKey('1');

    expect(key).toBe(12345);
    expect(useMonitorStore.getState().connKeys['1']).toBe(12345);
  });
});

// refs #337: connKeys was keyed by monitorId alone, so two profiles sharing
// the same monitor id (common with independent ZM servers) collided on one
// connkey slot. monitorCacheKey composes profileId:monitorId so both coexist.
describe('monitorCacheKey', () => {
  it('composes profileId and monitorId', () => {
    expect(monitorCacheKey(asProfileId('profile-a'), '1')).toBe('profile-a:1');
  });

  it('falls back to the bare monitorId when no profileId is given', () => {
    expect(monitorCacheKey(null, '1')).toBe('1');
    expect(monitorCacheKey(undefined, '1')).toBe('1');
  });

  it('gives two profiles with the same monitorId distinct connKey entries', () => {
    const keyA = monitorCacheKey(asProfileId('profile-a'), '1');
    const keyB = monitorCacheKey(asProfileId('profile-b'), '1');

    useMonitorStore.getState().getConnKey(keyA);
    vi.spyOn(Math, 'random').mockReturnValue(0.54321);
    useMonitorStore.getState().getConnKey(keyB);

    expect(useMonitorStore.getState().connKeys[keyA]).toBe(12345);
    expect(useMonitorStore.getState().connKeys[keyB]).toBe(54321);
  });
});
